//! 2D guillotine cutting optimizer (sheets) with kerf, grain and remnant constraints.
//! Mirrors optimizer2d.ts / optimizer2d.py: the same heuristics are tried in the same order
//! with the same floating-point operations, so all implementations return the same result.

use std::collections::HashSet;

use crate::evaluation::{is_better_evaluation, SolutionEvaluation};
use crate::round::to_fixed;
use crate::types::{
    Cut2D, CutType, Grain, MinRemnantSize, OptimizationResult, Part2D, Placement2D, Rect2D,
    Stock2D, StockResult2D, StockResults, Summary, UnplacedPart,
};
use crate::usage::compute_stock_usage;

/// Tolerance for floating-point comparisons (e.g. 0.1 + 0.2 fitting into 0.3).
const EPS: f64 = 1e-9;

/// Order in which parts are placed (all descending).
#[derive(Debug, Clone, Copy)]
enum SortRule {
    Area,
    LongSide,
    ShortSide,
    Perimeter,
}

/// How to score a free rectangle for a part (lower is better).
#[derive(Debug, Clone, Copy)]
enum FitRule {
    ShortSide,
    LongSide,
    Area,
}

/// Which guillotine cut to make first after placing a part.
#[derive(Debug, Clone, Copy)]
enum SplitRule {
    ShorterLeftoverAxis,
    LongerLeftoverAxis,
    MinArea,
    MaxArea,
}

/// Which stock to open when a part fits in no open stock.
#[derive(Debug, Clone, Copy)]
enum StockRule {
    Smallest,
    Largest,
    LowestCostRatio,
}

const SORT_RULES: [SortRule; 4] = [
    SortRule::Area,
    SortRule::LongSide,
    SortRule::ShortSide,
    SortRule::Perimeter,
];
const FIT_RULES: [FitRule; 3] = [FitRule::ShortSide, FitRule::LongSide, FitRule::Area];
const SPLIT_RULES: [SplitRule; 4] = [
    SplitRule::ShorterLeftoverAxis,
    SplitRule::LongerLeftoverAxis,
    SplitRule::MinArea,
    SplitRule::MaxArea,
];
const STOCK_RULES: [StockRule; 3] = [
    StockRule::Smallest,
    StockRule::Largest,
    StockRule::LowestCostRatio,
];

/// Heuristics are tried in list order, so larger inputs try only a prefix to keep runtime bounded:
/// above LARGE_INPUT_PIECES part pieces only the baseline sort order (36 heuristics), and above
/// HUGE_INPUT_PIECES only the baseline sort and fit rules (12 heuristics).
const LARGE_INPUT_PIECES: usize = 500;
const HUGE_INPUT_PIECES: usize = 2000;

/// The sheet-by-sheet strategy tries every sort/fit/split combination for every stock type on
/// every sheet, so it is only used up to this many part pieces.
const SHEET_BY_SHEET_MAX_PIECES: usize = 200;

#[derive(Debug, Clone, Copy)]
struct Heuristic {
    sort: SortRule,
    fit: FitRule,
    split: SplitRule,
    stock: StockRule,
}

/// All heuristic combinations. The first entry is the baseline (area / BSSF / SLAS / smallest
/// stock); later entries only replace it when they produce a strictly better solution.
fn heuristics() -> Vec<Heuristic> {
    let mut list = Vec::new();
    for sort in SORT_RULES {
        for fit in FIT_RULES {
            for split in SPLIT_RULES {
                for stock in STOCK_RULES {
                    list.push(Heuristic {
                        sort,
                        fit,
                        split,
                        stock,
                    });
                }
            }
        }
    }
    list
}

fn heuristic_count(pieces: usize, total: usize) -> usize {
    if pieces > HUGE_INPUT_PIECES {
        SPLIT_RULES.len() * STOCK_RULES.len()
    } else if pieces > LARGE_INPUT_PIECES {
        FIT_RULES.len() * SPLIT_RULES.len() * STOCK_RULES.len()
    } else {
        total
    }
}

#[derive(Debug)]
struct ExpandedPart {
    part_id: String,
    width: f64,
    height: f64,
    can_rotate: bool,
    grain: Grain,
    area: f64,
}

#[derive(Debug, Clone)]
struct FreeRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone)]
struct StockPoolItem {
    id: String,
    width: f64,
    height: f64,
    trim: f64,
    grain: Grain,
    cost: f64,
    remaining_quantity: f64,
}

#[derive(Debug, Clone)]
struct ActiveStock {
    stock_id: String,
    /// Index into the input stocks
    stock_index: usize,
    index: usize,
    width: f64,
    height: f64,
    trim: f64,
    grain: Grain,
    cost: f64,
    free_rects: Vec<FreeRect>,
    placements: Vec<Placement2D>,
    cuts: Vec<Cut2D>,
    cut_step_count: usize,
    /// Actual material removed by the blade
    cut_loss_area: f64,
    /// Largest free width / height over all free rects (for skipping stocks that cannot fit a part)
    max_free_width: f64,
    max_free_height: f64,
}

#[derive(Debug, Clone, Copy)]
struct PlacementFit {
    rect_index: usize,
    rotated: bool,
    part_width: f64,
    part_height: f64,
    /// Lower is better (depends on the fit rule)
    score: f64,
}

/// A finished packing pass: used sheets and unplaced part counts (in first-seen order).
struct Packing {
    active_stocks: Vec<ActiveStock>,
    unplaced: Vec<(String, usize)>,
}

fn add_unplaced(unplaced: &mut Vec<(String, usize)>, part_id: &str) {
    match unplaced.iter_mut().find(|(id, _)| id == part_id) {
        Some((_, count)) => *count += 1,
        None => unplaced.push((part_id.to_string(), 1)),
    }
}

/// Checks if a part orientation is allowed given the stock and part grain settings.
fn is_orientation_allowed(
    stock_grain: Grain,
    part_grain: Grain,
    can_rotate: bool,
    rotated: bool,
) -> bool {
    if rotated && !can_rotate {
        return false;
    }
    // If either has no grain direction, orientation is free (subject only to can_rotate)
    if stock_grain == Grain::None || part_grain == Grain::None {
        return true;
    }
    // Both have grain: it matches when not rotated if the directions are equal, otherwise when rotated
    if stock_grain == part_grain {
        !rotated
    } else {
        rotated
    }
}

/// Returns the (primary, secondary) sort keys of a part (sorted descending).
fn sort_keys(part: &ExpandedPart, rule: SortRule) -> (f64, f64) {
    let long_side = part.width.max(part.height);
    let short_side = part.width.min(part.height);
    match rule {
        SortRule::Area => (part.area, long_side),
        SortRule::LongSide => (long_side, short_side),
        SortRule::ShortSide => (short_side, long_side),
        SortRule::Perimeter => (part.width + part.height, long_side),
    }
}

/// Sorts parts descending by the rule's keys (stable, so ties keep input order).
fn sort_parts<'a>(parts: &[&'a ExpandedPart], rule: SortRule) -> Vec<&'a ExpandedPart> {
    let mut sorted = parts.to_vec();
    sorted.sort_by(|a, b| {
        let (a1, a2) = sort_keys(a, rule);
        let (b1, b2) = sort_keys(b, rule);
        if b1 != a1 {
            b1.partial_cmp(&a1).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            b2.partial_cmp(&a2).unwrap_or(std::cmp::Ordering::Equal)
        }
    });
    sorted
}

fn create_stock_pool(stocks: &[Stock2D]) -> Vec<StockPoolItem> {
    stocks
        .iter()
        .map(|s| StockPoolItem {
            id: s.id.clone(),
            width: s.width,
            height: s.height,
            trim: s.trim,
            grain: s.grain,
            cost: s.cost.unwrap_or(s.width * s.height),
            remaining_quantity: s.quantity,
        })
        .collect()
}

/// Creates an empty sheet of the given stock type (the caller updates the pool quantity).
fn open_stock(pool: &StockPoolItem, pool_index: usize, index: usize) -> ActiveStock {
    let usable_width = pool.width - pool.trim * 2.0;
    let usable_height = pool.height - pool.trim * 2.0;
    ActiveStock {
        stock_id: pool.id.clone(),
        stock_index: pool_index,
        index,
        width: pool.width,
        height: pool.height,
        trim: pool.trim,
        grain: pool.grain,
        cost: pool.cost,
        // The usable area inside the trimmed edges
        free_rects: vec![FreeRect {
            x: pool.trim,
            y: pool.trim,
            width: usable_width,
            height: usable_height,
        }],
        placements: Vec::new(),
        cuts: Vec::new(),
        cut_step_count: 0,
        cut_loss_area: 0.0,
        max_free_width: usable_width,
        max_free_height: usable_height,
    }
}

pub fn optimize_2d(
    stocks: &[Stock2D],
    parts: &[Part2D],
    kerf: f64,
    min_remnant_size: &MinRemnantSize,
) -> Result<OptimizationResult, String> {
    let min_remnant_width = min_remnant_size.width.unwrap_or(0.0);
    let min_remnant_height = min_remnant_size.height.unwrap_or(0.0);

    // Flatten parts
    let mut expanded = Vec::new();
    for p in parts {
        for _ in 0..p.quantity {
            expanded.push(ExpandedPart {
                part_id: p.id.clone(),
                width: p.width,
                height: p.height,
                can_rotate: p.can_rotate,
                grain: p.grain,
                area: p.width * p.height,
            });
        }
    }
    let expanded_refs: Vec<&ExpandedPart> = expanded.iter().collect();

    let all_heuristics = heuristics();
    let count = heuristic_count(expanded.len(), all_heuristics.len());

    let mut best: Option<(OptimizationResult, SolutionEvaluation)> = None;
    for heuristic in &all_heuristics[..count] {
        let packing = run_heuristic(stocks, &expanded_refs, kerf, heuristic);
        let candidate = build_result(
            stocks,
            packing,
            expanded.len(),
            min_remnant_width,
            min_remnant_height,
        );
        if best
            .as_ref()
            .map_or(true, |b| is_better_evaluation(&candidate.1, &b.1))
        {
            best = Some(candidate);
        }
    }

    if expanded.len() <= SHEET_BY_SHEET_MAX_PIECES {
        let packing = run_sheet_by_sheet(stocks, &expanded_refs, kerf);
        let candidate = build_result(
            stocks,
            packing,
            expanded.len(),
            min_remnant_width,
            min_remnant_height,
        );
        if best
            .as_ref()
            .map_or(true, |b| is_better_evaluation(&candidate.1, &b.1))
        {
            best = Some(candidate);
        }
    }

    Ok(best.expect("at least one heuristic runs").0)
}

/// Runs one greedy packing pass with the given heuristic.
fn run_heuristic(
    stocks: &[Stock2D],
    parts: &[&ExpandedPart],
    kerf: f64,
    heuristic: &Heuristic,
) -> Packing {
    let sorted_parts = sort_parts(parts, heuristic.sort);
    let mut stock_pool = create_stock_pool(stocks);
    let mut active_stocks: Vec<ActiveStock> = Vec::new();
    let mut unplaced = Vec::new();

    for part in sorted_parts {
        let mut best: Option<(usize, PlacementFit)> = None;

        // Search through existing open stocks
        for (s_idx, stock) in active_stocks.iter().enumerate() {
            if !may_fit(stock, part) {
                continue;
            }
            if let Some(fit) = find_best_fit(stock, part, heuristic.fit) {
                if best.map_or(true, |(_, b)| fit.score < b.score) {
                    best = Some((s_idx, fit));
                }
            }
        }

        if let Some((s_idx, fit)) = best {
            place_part_in_stock(&mut active_stocks[s_idx], part, fit, kerf, heuristic.split);
            continue;
        }

        // Open a new stock sheet
        let Some(pool_idx) = choose_stock(&stock_pool, part, heuristic.stock) else {
            add_unplaced(&mut unplaced, &part.part_id);
            continue;
        };
        stock_pool[pool_idx].remaining_quantity -= 1.0;
        let mut new_stock = open_stock(&stock_pool[pool_idx], pool_idx, active_stocks.len());
        match find_best_fit(&new_stock, part, heuristic.fit) {
            Some(fit) => {
                place_part_in_stock(&mut new_stock, part, fit, kerf, heuristic.split);
                active_stocks.push(new_stock);
            }
            None => {
                // Should not happen since feasibility was checked, but fall back safely
                stock_pool[pool_idx].remaining_quantity += 1.0;
                add_unplaced(&mut unplaced, &part.part_id);
            }
        }
    }

    Packing {
        active_stocks,
        unplaced,
    }
}

/// Quick necessary condition for a part to fit anywhere in the stock (either orientation).
/// Skipping stocks that fail it does not change the result, only the runtime.
fn may_fit(stock: &ActiveStock, part: &ExpandedPart) -> bool {
    let w = stock.max_free_width + EPS;
    let h = stock.max_free_height + EPS;
    (part.width <= w && part.height <= h) || (part.height <= w && part.width <= h)
}

fn update_max_free_size(stock: &mut ActiveStock) {
    let mut max_width = 0.0;
    let mut max_height = 0.0;
    for free in &stock.free_rects {
        if free.width > max_width {
            max_width = free.width;
        }
        if free.height > max_height {
            max_height = free.height;
        }
    }
    stock.max_free_width = max_width;
    stock.max_free_height = max_height;
}

/// Packs one sheet at a time: for every stock type and every sort/fit/split combination,
/// fill a single empty sheet greedily with the remaining parts, then keep the sheet that
/// uses the most part area per cost. Repeats until every part is placed or nothing fits.
fn run_sheet_by_sheet(stocks: &[Stock2D], parts: &[&ExpandedPart], kerf: f64) -> Packing {
    let mut stock_pool = create_stock_pool(stocks);
    let mut active_stocks: Vec<ActiveStock> = Vec::new();
    let mut remaining: Vec<&ExpandedPart> = parts.to_vec();

    while !remaining.is_empty() {
        // (sheet, placed parts (by address), used area)
        let mut best: Option<(ActiveStock, HashSet<*const ExpandedPart>, f64)> = None;

        for (p_idx, pool) in stock_pool.iter().enumerate() {
            if pool.remaining_quantity <= 0.0 {
                continue;
            }
            for sort in SORT_RULES {
                let sorted_parts = sort_parts(&remaining, sort);
                for fit_rule in FIT_RULES {
                    for split in SPLIT_RULES {
                        let mut sheet = open_stock(pool, p_idx, active_stocks.len());
                        let mut placed = HashSet::new();
                        let mut used_area = 0.0;
                        for &part in &sorted_parts {
                            if !may_fit(&sheet, part) {
                                continue;
                            }
                            let Some(fit) = find_best_fit(&sheet, part, fit_rule) else {
                                continue;
                            };
                            place_part_in_stock(&mut sheet, part, fit, kerf, split);
                            placed.insert(part as *const ExpandedPart);
                            used_area += part.area;
                        }
                        if placed.is_empty() {
                            continue;
                        }
                        let better = match &best {
                            None => true,
                            Some((best_sheet, _, best_area)) => {
                                is_better_sheet(used_area, sheet.cost, *best_area, best_sheet.cost)
                            }
                        };
                        if better {
                            best = Some((sheet, placed, used_area));
                        }
                    }
                }
            }
        }

        let Some((sheet, placed, _)) = best else {
            break; // No remaining part fits in any remaining stock
        };
        stock_pool[sheet.stock_index].remaining_quantity -= 1.0;
        active_stocks.push(sheet);
        remaining.retain(|&part| !placed.contains(&(part as *const ExpandedPart)));
    }

    let mut unplaced = Vec::new();
    for part in remaining {
        add_unplaced(&mut unplaced, &part.part_id);
    }
    Packing {
        active_stocks,
        unplaced,
    }
}

/// Compares sheets by part area per cost (cross-multiplied so a zero cost works),
/// then by part area. Returns true when sheet a is strictly better.
fn is_better_sheet(area_a: f64, cost_a: f64, area_b: f64, cost_b: f64) -> bool {
    let value_a = area_a * cost_b;
    let value_b = area_b * cost_a;
    let tolerance = EPS * 1f64.max(value_a.abs()).max(value_b.abs());
    if value_a > value_b + tolerance {
        return true;
    }
    if value_a < value_b - tolerance {
        return false;
    }
    area_a > area_b + EPS * 1f64.max(area_a).max(area_b)
}

/// Chooses which stock type to open for a part that fits in no open stock.
fn choose_stock(
    stock_pool: &[StockPoolItem],
    part: &ExpandedPart,
    rule: StockRule,
) -> Option<usize> {
    let mut chosen = None;
    let mut best_key = f64::INFINITY;
    let mut best_area = f64::INFINITY;

    for (p_idx, pool) in stock_pool.iter().enumerate() {
        if pool.remaining_quantity <= 0.0 {
            continue;
        }
        // Check if the part can fit in the usable (trimmed) area at all (including grain constraints)
        let usable_width = pool.width - pool.trim * 2.0;
        let usable_height = pool.height - pool.trim * 2.0;
        let can_fit_unrotated = part.width <= usable_width + EPS
            && part.height <= usable_height + EPS
            && is_orientation_allowed(pool.grain, part.grain, part.can_rotate, false);
        let can_fit_rotated = part.height <= usable_width + EPS
            && part.width <= usable_height + EPS
            && is_orientation_allowed(pool.grain, part.grain, part.can_rotate, true);
        if !can_fit_unrotated && !can_fit_rotated {
            continue;
        }

        let area = usable_width * usable_height;
        let key = match rule {
            StockRule::Smallest => area,
            StockRule::Largest => -area,
            StockRule::LowestCostRatio => pool.cost / area,
        };
        // Ties are broken by the smaller area, then by input order
        if key < best_key - EPS || ((key - best_key).abs() <= EPS && area < best_area) {
            best_key = key;
            best_area = area;
            chosen = Some(p_idx);
        }
    }
    chosen
}

/// Builds the output result and its evaluation from a finished packing pass.
fn build_result(
    stocks: &[Stock2D],
    packing: Packing,
    total_parts_count: usize,
    min_remnant_width: f64,
    min_remnant_height: f64,
) -> (OptimizationResult, SolutionEvaluation) {
    let mut result_stocks = Vec::new();
    let mut total_stock_measure = 0.0;
    let mut total_used_measure = 0.0;
    let mut total_waste_measure = 0.0;
    let mut total_remnant_measure = 0.0;
    let mut total_placed_count = 0;
    let mut total_cost = 0.0;
    let mut cut_count = 0;
    let used_indices: Vec<usize> = packing
        .active_stocks
        .iter()
        .map(|s| s.stock_index)
        .collect();

    for stock in packing.active_stocks {
        let stock_area = stock.width * stock.height;
        total_stock_measure += stock_area;
        total_cost += stock.cost;
        cut_count += stock.cuts.len();

        let mut stock_parts_area = 0.0;
        for p in &stock.placements {
            stock_parts_area += p.width * p.height;
        }
        total_used_measure += stock_parts_area;
        total_placed_count += stock.placements.len();

        let mut remnants = Vec::new();
        let mut waste = trim_strips(&stock);
        for strip in &waste {
            total_waste_measure += strip.width * strip.height;
        }

        for rect in &stock.free_rects {
            if rect.width <= 0.0 || rect.height <= 0.0 {
                continue;
            }
            let area = rect.width * rect.height;
            let r = Rect2D {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            };
            if is_remnant_rect(rect, stock.grain, min_remnant_width, min_remnant_height) {
                remnants.push(r);
                total_remnant_measure += area;
            } else {
                waste.push(r);
                total_waste_measure += area;
            }
        }

        // Cut loss area (kerf * length, or less when the leftover was thinner than the kerf)
        total_waste_measure += stock.cut_loss_area;

        result_stocks.push(StockResult2D {
            stock_id: stock.stock_id,
            index: stock.index,
            width: stock.width,
            height: stock.height,
            placements: stock.placements,
            cuts: stock.cuts,
            remnants,
            waste,
        });
    }

    let mut unplaced_count = 0;
    let unplaced_parts: Vec<UnplacedPart> = packing
        .unplaced
        .into_iter()
        .map(|(part_id, quantity)| {
            unplaced_count += quantity;
            UnplacedPart { part_id, quantity }
        })
        .collect();

    let yield_rate = if total_stock_measure > 0.0 {
        total_used_measure / total_stock_measure
    } else {
        0.0
    };
    let usage_stocks: Vec<(&str, Option<f64>)> =
        stocks.iter().map(|s| (s.id.as_str(), s.cost)).collect();

    let stock_count = result_stocks.len();
    let result = OptimizationResult {
        summary: Summary {
            stock_count_used: stock_count,
            parts_placed: total_placed_count,
            parts_total: total_parts_count,
            total_stock_measure: to_fixed(total_stock_measure, 4),
            total_used_measure: to_fixed(total_used_measure, 4),
            total_waste_measure: to_fixed(total_waste_measure, 4),
            total_remnant_measure: to_fixed(total_remnant_measure, 4),
            yield_rate: to_fixed(yield_rate, 4),
            stock_usage: compute_stock_usage(&usage_stocks, &used_indices),
        },
        stocks: StockResults::TwoD(result_stocks),
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

/// Strips removed by the edge trim (top, bottom, left, right), reported as waste.
fn trim_strips(stock: &ActiveStock) -> Vec<Rect2D> {
    let t = stock.trim;
    if t <= 0.0 {
        return Vec::new();
    }
    let inner_height = stock.height - t * 2.0;
    vec![
        Rect2D {
            x: 0.0,
            y: 0.0,
            width: stock.width,
            height: t,
        },
        Rect2D {
            x: 0.0,
            y: stock.height - t,
            width: stock.width,
            height: t,
        },
        Rect2D {
            x: 0.0,
            y: t,
            width: t,
            height: inner_height,
        },
        Rect2D {
            x: stock.width - t,
            y: t,
            width: t,
            height: inner_height,
        },
    ]
}

/// A leftover rect is a reusable remnant when it meets min_remnant_size.
/// Without grain the remnant can be turned, so either orientation qualifies;
/// with grain the orientation is fixed.
fn is_remnant_rect(
    rect: &FreeRect,
    stock_grain: Grain,
    min_remnant_width: f64,
    min_remnant_height: f64,
) -> bool {
    if min_remnant_width <= 0.0 && min_remnant_height <= 0.0 {
        return false;
    }
    let fits_as_is = rect.width >= min_remnant_width && rect.height >= min_remnant_height;
    let fits_turned = rect.height >= min_remnant_width && rect.width >= min_remnant_height;
    fits_as_is || (stock_grain == Grain::None && fits_turned)
}

/// Finds the best free rectangle in the stock for the part (lowest score wins;
/// rects in order, unrotated before rotated, strictly lower score replaces).
fn find_best_fit(stock: &ActiveStock, part: &ExpandedPart, rule: FitRule) -> Option<PlacementFit> {
    let mut best: Option<PlacementFit> = None;
    let mut min_score = f64::INFINITY;
    let orientations = [
        (false, part.width, part.height),
        (true, part.height, part.width),
    ];

    for (i, free) in stock.free_rects.iter().enumerate() {
        for &(rotated, pw, ph) in &orientations {
            if pw <= free.width + EPS
                && ph <= free.height + EPS
                && is_orientation_allowed(stock.grain, part.grain, part.can_rotate, rotated)
            {
                let score = fit_score(free, pw, ph, rule);
                if score < min_score {
                    min_score = score;
                    best = Some(PlacementFit {
                        rect_index: i,
                        rotated,
                        part_width: pw,
                        part_height: ph,
                        score,
                    });
                }
            }
        }
    }
    best
}

fn fit_score(free: &FreeRect, pw: f64, ph: f64, rule: FitRule) -> f64 {
    let leftover_w = free.width - pw;
    let leftover_h = free.height - ph;
    match rule {
        FitRule::ShortSide => leftover_w.min(leftover_h),
        FitRule::LongSide => leftover_w.max(leftover_h),
        FitRule::Area => free.width * free.height - pw * ph,
    }
}

/// Decides whether the full-length cut runs horizontally (true) or vertically (false).
fn should_split_horizontal(
    pw: f64,
    ph: f64,
    leftover_w: f64,
    leftover_h: f64,
    rule: SplitRule,
) -> bool {
    match rule {
        // Split along the axis that leaves the smaller remnant, maximizing the size of the other remnant
        SplitRule::ShorterLeftoverAxis => leftover_w <= leftover_h,
        SplitRule::LongerLeftoverAxis => leftover_w > leftover_h,
        // Makes the smaller of the two new free rects as small as possible
        SplitRule::MinArea => pw * leftover_h > ph * leftover_w,
        // Keeps the two new free rects as balanced as possible
        SplitRule::MaxArea => pw * leftover_h <= ph * leftover_w,
    }
}

/// Places a part into the selected free rectangle and performs a guillotine split,
/// taking kerf into account and producing guillotine cut segments.
fn place_part_in_stock(
    stock: &mut ActiveStock,
    part: &ExpandedPart,
    fit: PlacementFit,
    kerf: f64,
    split: SplitRule,
) {
    let free = stock.free_rects.remove(fit.rect_index);
    let pw = fit.part_width;
    let ph = fit.part_height;
    let px = free.x;
    let py = free.y;

    stock.placements.push(Placement2D {
        part_id: part.part_id.clone(),
        x: px,
        y: py,
        width: pw,
        height: ph,
        rotated: fit.rotated,
    });

    let leftover_w = free.width - pw;
    let leftover_h = free.height - ph;
    let has_leftover_w = leftover_w > EPS;
    let has_leftover_h = leftover_h > EPS;

    let split_horizontal = should_split_horizontal(pw, ph, leftover_w, leftover_h, split);

    // Width/height of the free rects left after the blade passes (<= 0 when the kerf eats the leftover)
    let top_h = free.height - ph - kerf;
    let right_w = free.width - pw - kerf;

    let add_cut =
        |stock: &mut ActiveStock, cut_type: CutType, x: f64, y: f64, length: f64, loss: f64| {
            stock.cut_step_count += 1;
            stock.cuts.push(Cut2D {
                cut_type,
                x,
                y,
                length,
                kerf,
                step: stock.cut_step_count,
            });
            stock.cut_loss_area += loss;
        };

    if split_horizontal {
        // Horizontal cut across the full width of this free rect, then a vertical cut up to it
        if has_leftover_h {
            add_cut(
                stock,
                CutType::Horizontal,
                px,
                py + ph,
                free.width,
                kerf.min(leftover_h) * free.width,
            );
        }
        if has_leftover_w {
            add_cut(
                stock,
                CutType::Vertical,
                px + pw,
                py,
                ph,
                kerf.min(leftover_w) * ph,
            );
        }
        if has_leftover_h && top_h > EPS {
            stock.free_rects.push(FreeRect {
                x: px,
                y: py + ph + kerf,
                width: free.width,
                height: top_h,
            });
        }
        if has_leftover_w && right_w > EPS {
            stock.free_rects.push(FreeRect {
                x: px + pw + kerf,
                y: py,
                width: right_w,
                height: ph,
            });
        }
    } else {
        // Vertical cut across the full height of this free rect, then a horizontal cut within the column
        if has_leftover_w {
            add_cut(
                stock,
                CutType::Vertical,
                px + pw,
                py,
                free.height,
                kerf.min(leftover_w) * free.height,
            );
        }
        if has_leftover_h {
            add_cut(
                stock,
                CutType::Horizontal,
                px,
                py + ph,
                pw,
                kerf.min(leftover_h) * pw,
            );
        }
        if has_leftover_w && right_w > EPS {
            stock.free_rects.push(FreeRect {
                x: px + pw + kerf,
                y: py,
                width: right_w,
                height: free.height,
            });
        }
        if has_leftover_h && top_h > EPS {
            stock.free_rects.push(FreeRect {
                x: px,
                y: py + ph + kerf,
                width: pw,
                height: top_h,
            });
        }
    }

    update_max_free_size(stock);
}
