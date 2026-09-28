//! Generic 1D bin packing (no woodworking-specific constraints).
//!
//! Mirrors `binPack1D` / `bin_pack_1d` in the TypeScript / Python implementations.

use crate::round::to_fixed;

/// Tolerance for floating-point comparisons (e.g. 0.1 + 0.2 fitting into 0.3).
const EPS: f64 = 1e-9;

/// Heuristic used to choose an open bin for each item (items are sorted by size descending).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PackingStrategy1D {
    #[default]
    BestFitDecreasing,
    FirstFitDecreasing,
    WorstFitDecreasing,
}

/// Which bin type to open when an item fits in no open bin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BinSelection1D {
    /// The smallest capacity that fits the item
    #[default]
    Smallest,
    /// The largest capacity
    Largest,
    /// The lowest cost per unit of capacity (ties: smaller capacity)
    LowestCostRatio,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BinDefinition<T> {
    pub id: String,
    pub capacity: f64,
    /// Available quantity (defaults to 1); `f64::INFINITY` for unlimited.
    pub quantity: Option<f64>,
    /// Cost or selection priority (defaults to the capacity).
    pub cost: Option<f64>,
    pub data: Option<T>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ItemDefinition<T> {
    pub id: String,
    pub size: f64,
    /// Number of copies of this item (defaults to 1).
    pub quantity: Option<usize>,
    pub data: Option<T>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BinPacking1DOptions {
    /// Spacing / gap required between adjacent items in the same bin (e.g. saw kerf).
    pub item_spacing: f64,
    pub strategy: PackingStrategy1D,
    pub bin_selection: BinSelection1D,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PackedItem<T> {
    pub id: String,
    pub size: f64,
    /// Starting offset/position in the bin
    pub offset: f64,
    pub data: Option<T>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PackedBin<TBin, TItem> {
    pub bin_id: String,
    pub index: usize,
    pub capacity: f64,
    pub used_capacity: f64,
    pub remaining_capacity: f64,
    /// used item size / capacity (0.0 - 1.0)
    pub utilization: f64,
    pub items: Vec<PackedItem<TItem>>,
    pub data: Option<TBin>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnpackedItem<T> {
    pub id: String,
    pub size: f64,
    pub quantity: usize,
    pub data: Option<T>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BinPacking1DSummary {
    pub bins_used: usize,
    pub items_packed: usize,
    pub items_total: usize,
    pub total_capacity: f64,
    pub total_item_size: f64,
    pub average_utilization: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BinPacking1DResult<TBin, TItem> {
    pub bins: Vec<PackedBin<TBin, TItem>>,
    pub unpacked_items: Vec<UnpackedItem<TItem>>,
    pub summary: BinPacking1DSummary,
}

struct PoolBin<'a, T> {
    def: &'a BinDefinition<T>,
    cost: f64,
    remaining_quantity: f64,
}

fn validate<TBin, TItem>(
    bins: &[BinDefinition<TBin>],
    items: &[ItemDefinition<TItem>],
    options: &BinPacking1DOptions,
) -> Result<(), String> {
    if !options.item_spacing.is_finite() || options.item_spacing < 0.0 {
        return Err(format!(
            "item_spacing must be a finite number >= 0 (got {})",
            options.item_spacing
        ));
    }
    for b in bins {
        if !b.capacity.is_finite() || b.capacity <= 0.0 {
            return Err(format!(
                "Bin \"{}\": capacity must be a finite number > 0 (got {})",
                b.id, b.capacity
            ));
        }
        if let Some(cost) = b.cost {
            if !cost.is_finite() || cost < 0.0 {
                return Err(format!(
                    "Bin \"{}\": cost must be a finite number >= 0 (got {})",
                    b.id, cost
                ));
            }
        }
        let q = b.quantity.unwrap_or(1.0);
        if q != f64::INFINITY && (q.fract() != 0.0 || q < 0.0 || !q.is_finite()) {
            return Err(format!(
                "Bin \"{}\": quantity must be an integer >= 0 or infinity (got {})",
                b.id, q
            ));
        }
    }
    for it in items {
        if !it.size.is_finite() || it.size <= 0.0 {
            return Err(format!(
                "Item \"{}\": size must be a finite number > 0 (got {})",
                it.id, it.size
            ));
        }
    }
    Ok(())
}

/// Chooses which bin type to open for an item. Returns None when no remaining bin can hold it.
fn choose_bin<T>(pool: &[PoolBin<T>], size: f64, rule: BinSelection1D) -> Option<usize> {
    let mut chosen = None;
    let mut best_key = f64::INFINITY;
    let mut best_capacity = f64::INFINITY;

    for (i, bin) in pool.iter().enumerate() {
        let capacity = bin.def.capacity;
        if bin.remaining_quantity <= 0.0 || capacity < size - EPS {
            continue;
        }
        let key = match rule {
            BinSelection1D::Smallest => capacity,
            BinSelection1D::Largest => -capacity,
            BinSelection1D::LowestCostRatio => bin.cost / capacity,
        };
        // Ties are broken by the smaller capacity, then by input order
        if key < best_key - EPS || ((key - best_key).abs() <= EPS && capacity < best_capacity) {
            best_key = key;
            best_capacity = capacity;
            chosen = Some(i);
        }
    }
    chosen
}

struct ActiveBin<'a, TBin, TItem> {
    def: &'a BinDefinition<TBin>,
    index: usize,
    /// Offset of the end of the last placed item
    used_offset: f64,
    items: Vec<PackedItem<TItem>>,
}

/// Packs items into bins with minimal waste, supporting multiple bin sizes,
/// item spacing (e.g. kerf/blade width), and BFD / FFD / WFD heuristics.
pub fn bin_pack_1d<TBin: Clone, TItem: Clone>(
    bins: &[BinDefinition<TBin>],
    items: &[ItemDefinition<TItem>],
    options: &BinPacking1DOptions,
) -> Result<BinPacking1DResult<TBin, TItem>, String> {
    validate(bins, items, options)?;
    let item_spacing = options.item_spacing;

    // 1. Flatten items based on quantity
    let mut expanded: Vec<&ItemDefinition<TItem>> = Vec::new();
    let mut total_items_count = 0;
    for item in items {
        let qty = item.quantity.unwrap_or(1);
        total_items_count += qty;
        for _ in 0..qty {
            expanded.push(item);
        }
    }

    // 2. Sort items descending by size (stable)
    expanded.sort_by(|a, b| {
        b.size
            .partial_cmp(&a.size)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // 3. Bin inventory pool
    let mut pool: Vec<PoolBin<TBin>> = bins
        .iter()
        .map(|b| PoolBin {
            def: b,
            cost: b.cost.unwrap_or(b.capacity),
            remaining_quantity: b.quantity.unwrap_or(1.0),
        })
        .collect();

    let mut active: Vec<ActiveBin<TBin, TItem>> = Vec::new();
    let mut unpacked: Vec<UnpackedItem<TItem>> = Vec::new();

    // 4. Place each item
    for item in expanded {
        let mut chosen_bin: Option<usize> = None;
        match options.strategy {
            PackingStrategy1D::BestFitDecreasing => {
                let mut min_remaining = f64::INFINITY;
                for (i, bin) in active.iter().enumerate() {
                    let additional = if bin.items.is_empty() {
                        item.size
                    } else {
                        item_spacing + item.size
                    };
                    let space_left = bin.def.capacity - bin.used_offset;
                    if space_left >= additional - EPS {
                        let remaining = space_left - additional;
                        if remaining < min_remaining {
                            min_remaining = remaining;
                            chosen_bin = Some(i);
                        }
                    }
                }
            }
            PackingStrategy1D::FirstFitDecreasing => {
                for (i, bin) in active.iter().enumerate() {
                    let additional = if bin.items.is_empty() {
                        item.size
                    } else {
                        item_spacing + item.size
                    };
                    let space_left = bin.def.capacity - bin.used_offset;
                    if space_left >= additional - EPS {
                        chosen_bin = Some(i);
                        break;
                    }
                }
            }
            PackingStrategy1D::WorstFitDecreasing => {
                let mut max_remaining = -1.0;
                for (i, bin) in active.iter().enumerate() {
                    let additional = if bin.items.is_empty() {
                        item.size
                    } else {
                        item_spacing + item.size
                    };
                    let space_left = bin.def.capacity - bin.used_offset;
                    if space_left >= additional - EPS {
                        let remaining = space_left - additional;
                        if remaining > max_remaining {
                            max_remaining = remaining;
                            chosen_bin = Some(i);
                        }
                    }
                }
            }
        }

        if let Some(i) = chosen_bin {
            let bin = &mut active[i];
            let start = if bin.items.is_empty() {
                bin.used_offset
            } else {
                bin.used_offset + item_spacing
            };
            bin.items.push(PackedItem {
                id: item.id.clone(),
                size: item.size,
                offset: start,
                data: item.data.clone(),
            });
            bin.used_offset = start + item.size;
        } else if let Some(p) = choose_bin(&pool, item.size, options.bin_selection) {
            pool[p].remaining_quantity -= 1.0;
            active.push(ActiveBin {
                def: pool[p].def,
                index: active.len(),
                used_offset: item.size,
                items: vec![PackedItem {
                    id: item.id.clone(),
                    size: item.size,
                    offset: 0.0,
                    data: item.data.clone(),
                }],
            });
        } else if let Some(existing) = unpacked.iter_mut().find(|u| u.id == item.id) {
            existing.quantity += 1;
        } else {
            unpacked.push(UnpackedItem {
                id: item.id.clone(),
                size: item.size,
                quantity: 1,
                data: item.data.clone(),
            });
        }
    }

    // 5. Results and metrics
    let mut total_capacity = 0.0;
    let mut total_item_size = 0.0;
    let mut total_items_packed = 0;
    let result_bins: Vec<PackedBin<TBin, TItem>> = active
        .into_iter()
        .map(|bin| {
            let capacity = bin.def.capacity;
            total_capacity += capacity;
            let items_size = bin.items.iter().fold(0.0, |sum, it| sum + it.size);
            total_item_size += items_size;
            total_items_packed += bin.items.len();
            let remaining = (capacity - bin.used_offset).max(0.0);
            let utilization = if capacity > 0.0 {
                items_size / capacity
            } else {
                0.0
            };
            PackedBin {
                bin_id: bin.def.id.clone(),
                index: bin.index,
                capacity,
                used_capacity: bin.used_offset,
                remaining_capacity: to_fixed(remaining, 6),
                utilization: to_fixed(utilization, 4),
                items: bin.items,
                data: bin.def.data.clone(),
            }
        })
        .collect();

    let average_utilization = if total_capacity > 0.0 {
        total_item_size / total_capacity
    } else {
        0.0
    };
    Ok(BinPacking1DResult {
        summary: BinPacking1DSummary {
            bins_used: result_bins.len(),
            items_packed: total_items_packed,
            items_total: total_items_count,
            total_capacity: to_fixed(total_capacity, 6),
            total_item_size: to_fixed(total_item_size, 6),
            average_utilization: to_fixed(average_utilization, 4),
        },
        bins: result_bins,
        unpacked_items: unpacked,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bin(id: &str, capacity: f64, quantity: f64) -> BinDefinition<()> {
        BinDefinition {
            id: id.into(),
            capacity,
            quantity: Some(quantity),
            cost: None,
            data: None,
        }
    }

    fn item(id: &str, size: f64, quantity: usize) -> ItemDefinition<()> {
        ItemDefinition {
            id: id.into(),
            size,
            quantity: Some(quantity),
            data: None,
        }
    }

    #[test]
    fn packs_without_spacing() {
        let result = bin_pack_1d(
            &[bin("b", 100.0, 2.0)],
            &[item("a", 60.0, 1), item("b", 40.0, 1), item("c", 50.0, 2)],
            &BinPacking1DOptions::default(),
        )
        .unwrap();
        assert_eq!(result.bins.len(), 2);
        assert_eq!(result.summary.average_utilization, 1.0);
    }

    #[test]
    fn respects_item_spacing() {
        let options = BinPacking1DOptions {
            item_spacing: 5.0,
            ..Default::default()
        };
        let result = bin_pack_1d(
            &[bin("b", 100.0, 2.0)],
            &[item("a", 40.0, 2), item("b", 20.0, 1)],
            &options,
        )
        .unwrap();
        assert_eq!(result.bins[0].items[1].offset, 45.0);
        assert_eq!(result.bins[0].used_capacity, 85.0);
        assert_eq!(result.bins.len(), 2);
    }

    #[test]
    fn tracks_unpacked_items_and_unlimited_bins() {
        let result = bin_pack_1d(
            &[bin("b", 50.0, 1.0)],
            &[item("huge", 100.0, 2)],
            &BinPacking1DOptions::default(),
        )
        .unwrap();
        assert_eq!(result.unpacked_items[0].quantity, 2);
        let result = bin_pack_1d(
            &[bin("b", 10.0, f64::INFINITY)],
            &[item("i", 6.0, 5)],
            &BinPacking1DOptions::default(),
        )
        .unwrap();
        assert_eq!(result.summary.bins_used, 5);
    }

    #[test]
    fn opens_largest_bin_when_requested() {
        let options = BinPacking1DOptions {
            bin_selection: BinSelection1D::Largest,
            ..Default::default()
        };
        let result = bin_pack_1d(
            &[bin("small", 10.0, 5.0), bin("large", 30.0, 5.0)],
            &[item("i", 5.0, 6)],
            &options,
        )
        .unwrap();
        assert_eq!(
            result
                .bins
                .iter()
                .map(|b| b.bin_id.as_str())
                .collect::<Vec<_>>(),
            ["large"]
        );
    }

    #[test]
    fn rejects_invalid_input() {
        let options = BinPacking1DOptions {
            item_spacing: -1.0,
            ..Default::default()
        };
        assert!(bin_pack_1d(&[bin("b", 10.0, 1.0)], &[item("i", 5.0, 1)], &options).is_err());
        assert!(bin_pack_1d(
            &[bin("b", 0.0, 1.0)],
            &[item("i", 5.0, 1)],
            &BinPacking1DOptions::default()
        )
        .is_err());
    }
}
