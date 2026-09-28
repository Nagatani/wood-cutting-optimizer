//! 1D cutting optimizer (lumber). Mirrors optimizer1d.ts / optimizer1d.py.

use crate::binpacking::{
    bin_pack_1d, BinDefinition, BinPacking1DOptions, BinPacking1DResult, BinSelection1D,
    ItemDefinition, PackingStrategy1D,
};
use crate::evaluation::{is_better_evaluation, SolutionEvaluation};
use crate::round::to_fixed;
use crate::types::{
    Cut1D, MinRemnantSize, OptimizationResult, Part1D, Placement1D, Segment1D, Stock1D,
    StockResult1D, StockResults, Summary, UnplacedPart,
};
use crate::usage::compute_stock_usage;

const EPS: f64 = 1e-9;

/// Heuristic combinations tried by optimize_1d. The first entry is the baseline
/// (best-fit-decreasing / smallest stock); later entries only replace it when strictly better.
const STRATEGIES: [PackingStrategy1D; 3] = [
    PackingStrategy1D::BestFitDecreasing,
    PackingStrategy1D::FirstFitDecreasing,
    PackingStrategy1D::WorstFitDecreasing,
];
const BIN_SELECTIONS: [BinSelection1D; 3] = [
    BinSelection1D::Smallest,
    BinSelection1D::Largest,
    BinSelection1D::LowestCostRatio,
];

struct UsedStock1D {
    /// Index into the input stocks
    stock_index: usize,
    index: usize,
    /// (id, size, offset) of the packed parts
    items: Vec<(String, f64, f64)>,
    /// End offset of the last item
    used_capacity: f64,
}

/// Length available for parts after trimming both ends.
fn usable_length(stock: &Stock1D) -> f64 {
    stock.length - stock.trim * 2.0
}

fn stock_cost(stock: &Stock1D) -> f64 {
    stock.cost.unwrap_or(stock.length)
}

pub fn optimize_1d(
    stocks: &[Stock1D],
    parts: &[Part1D],
    kerf: f64,
    min_remnant_size: &MinRemnantSize,
) -> Result<OptimizationResult, String> {
    let min_remnant_length = min_remnant_size.length.unwrap_or(0.0);

    let bins: Vec<BinDefinition<usize>> = stocks
        .iter()
        .enumerate()
        .map(|(i, s)| BinDefinition {
            id: s.id.clone(),
            capacity: usable_length(s),
            quantity: Some(s.quantity),
            cost: Some(stock_cost(s)),
            data: Some(i),
        })
        .collect();

    let items: Vec<ItemDefinition<()>> = parts
        .iter()
        .map(|p| ItemDefinition {
            id: p.id.clone(),
            size: p.length,
            quantity: Some(p.quantity),
            data: None,
        })
        .collect();

    let mut best: Option<(OptimizationResult, SolutionEvaluation)> = None;
    for strategy in STRATEGIES {
        for bin_selection in BIN_SELECTIONS {
            let options = BinPacking1DOptions {
                item_spacing: kerf,
                strategy,
                bin_selection,
            };
            let pack_result = bin_pack_1d(&bins, &items, &options)?;
            let used_stocks = downsize_stocks(stocks, &pack_result);
            let candidate =
                build_result(stocks, &used_stocks, &pack_result, kerf, min_remnant_length);
            if best
                .as_ref()
                .map_or(true, |b| is_better_evaluation(&candidate.1, &b.1))
            {
                best = Some(candidate);
            }
        }
    }

    Ok(best.expect("at least one heuristic runs").0)
}

/// Swaps each used stock for the cheapest remaining stock type that still holds its parts
/// (e.g. a 3m stock holding 1.5m of parts becomes a 2m stock when one is available and cheaper).
fn downsize_stocks(
    stocks: &[Stock1D],
    pack_result: &BinPacking1DResult<usize, ()>,
) -> Vec<UsedStock1D> {
    let mut remaining: Vec<f64> = stocks.iter().map(|s| s.quantity).collect();
    let mut used_stocks: Vec<UsedStock1D> = pack_result
        .bins
        .iter()
        .map(|bin| {
            let stock_index = bin.data.expect("bins carry their stock index");
            remaining[stock_index] -= 1.0;
            UsedStock1D {
                stock_index,
                index: bin.index,
                items: bin
                    .items
                    .iter()
                    .map(|it| (it.id.clone(), it.size, it.offset))
                    .collect(),
                used_capacity: bin.used_capacity,
            }
        })
        .collect();

    for used in used_stocks.iter_mut() {
        let mut best_index = used.stock_index;
        for (j, candidate) in stocks.iter().enumerate() {
            if j == used.stock_index || remaining[j] <= 0.0 {
                continue;
            }
            if usable_length(candidate) < used.used_capacity - EPS {
                continue;
            }
            let cost = stock_cost(candidate);
            let best_cost = stock_cost(&stocks[best_index]);
            if cost < best_cost - EPS
                || ((cost - best_cost).abs() <= EPS && candidate.length < stocks[best_index].length)
            {
                best_index = j;
            }
        }
        if best_index != used.stock_index {
            remaining[used.stock_index] += 1.0;
            remaining[best_index] -= 1.0;
            used.stock_index = best_index;
        }
    }

    used_stocks
}

fn build_result(
    stocks: &[Stock1D],
    used_stocks: &[UsedStock1D],
    pack_result: &BinPacking1DResult<usize, ()>,
    kerf: f64,
    min_remnant_length: f64,
) -> (OptimizationResult, SolutionEvaluation) {
    let mut result_stocks = Vec::new();
    let mut total_stock_measure = 0.0;
    let mut total_used_measure = 0.0;
    let mut total_waste_measure = 0.0;
    let mut total_remnant_measure = 0.0;
    let mut total_placed_count = 0;
    let mut total_cost = 0.0;
    let mut cut_count = 0;

    for used in used_stocks {
        let stock = &stocks[used.stock_index];
        // Parts are laid out after the trimmed start of the stock
        let trim = stock.trim;
        let capacity = usable_length(stock);
        total_stock_measure += stock.length;
        total_cost += stock_cost(stock);
        let mut placements = Vec::new();
        let mut cuts = Vec::new();

        for (i, (id, size, offset)) in used.items.iter().enumerate() {
            if i > 0 {
                cuts.push(Cut1D {
                    x: trim + offset - kerf,
                    kerf,
                    step: i,
                });
            }
            placements.push(Placement1D {
                part_id: id.clone(),
                x: trim + offset,
                length: *size,
            });
            total_used_measure += size;
        }

        total_placed_count += placements.len();

        // Cut loss between parts
        let mut cut_loss = cuts.len() as f64 * kerf;

        let remaining = to_fixed((capacity - used.used_capacity).max(0.0), 6);
        let mut remnants = Vec::new();
        let mut waste = Vec::new();

        // Trimmed ends are waste
        if trim > 0.0 {
            waste.push(Segment1D {
                x: 0.0,
                length: trim,
            });
            total_waste_measure += trim * 2.0;
        }

        if remaining > EPS {
            // A final cut separates the last part from the leftover.
            // If the leftover is thinner than the kerf, the blade consumes all of it.
            let end_cut_loss = kerf.min(remaining);
            let step = cuts.len() + 1;
            cuts.push(Cut1D {
                x: trim + used.used_capacity,
                kerf,
                step,
            });
            cut_loss += end_cut_loss;

            let leftover = to_fixed(remaining - end_cut_loss, 6);
            if leftover > EPS {
                let segment = Segment1D {
                    x: trim + used.used_capacity + end_cut_loss,
                    length: leftover,
                };
                if min_remnant_length > 0.0 && leftover >= min_remnant_length {
                    remnants.push(segment);
                    total_remnant_measure += leftover;
                } else {
                    waste.push(segment);
                    total_waste_measure += leftover;
                }
            }
        }

        if trim > 0.0 {
            waste.push(Segment1D {
                x: stock.length - trim,
                length: trim,
            });
        }

        // Cut loss is also considered waste
        total_waste_measure += cut_loss;
        cut_count += cuts.len();

        result_stocks.push(StockResult1D {
            stock_id: stock.id.clone(),
            index: used.index,
            length: stock.length,
            placements,
            cuts,
            remnants,
            waste,
        });
    }

    let unplaced_parts: Vec<UnplacedPart> = pack_result
        .unpacked_items
        .iter()
        .map(|u| UnplacedPart {
            part_id: u.id.clone(),
            quantity: u.quantity,
        })
        .collect();
    let unplaced_count = unplaced_parts.iter().map(|u| u.quantity).sum();

    let yield_rate = if total_stock_measure > 0.0 {
        total_used_measure / total_stock_measure
    } else {
        0.0
    };
    let usage_stocks: Vec<(&str, Option<f64>)> =
        stocks.iter().map(|s| (s.id.as_str(), s.cost)).collect();
    let used_indices: Vec<usize> = used_stocks.iter().map(|u| u.stock_index).collect();

    let stock_count = result_stocks.len();
    let result = OptimizationResult {
        summary: Summary {
            stock_count_used: stock_count,
            parts_placed: total_placed_count,
            parts_total: pack_result.summary.items_total,
            total_stock_measure: to_fixed(total_stock_measure, 4),
            total_used_measure: to_fixed(total_used_measure, 4),
            total_waste_measure: to_fixed(total_waste_measure, 4),
            total_remnant_measure: to_fixed(total_remnant_measure, 4),
            yield_rate: to_fixed(yield_rate, 4),
            stock_usage: compute_stock_usage(&usage_stocks, &used_indices),
        },
        stocks: StockResults::OneD(result_stocks),
        unplaced_parts,
    };
    let evaluation = SolutionEvaluation {
        unplaced_count,
        total_cost,
        stock_count,
        remnant_measure: total_remnant_measure,
        cut_count,
    };
    (result, evaluation)
}
