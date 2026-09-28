//! Purchase list (`summary.stock_usage`).

use crate::round::to_fixed;
use crate::types::StockUsage;

/// Aggregates how many of each input stock entry were used, in input order (a purchase list).
/// `cost` is the unit cost times the quantity, or None when the stock has no cost.
pub fn compute_stock_usage(
    stocks: &[(&str, Option<f64>)],
    used_stock_indices: &[usize],
) -> Vec<StockUsage> {
    let mut counts = vec![0usize; stocks.len()];
    for &i in used_stock_indices {
        counts[i] += 1;
    }
    stocks
        .iter()
        .zip(counts)
        .filter(|(_, count)| *count > 0)
        .map(|((id, cost), count)| StockUsage {
            stock_id: id.to_string(),
            quantity: count,
            cost: cost.map(|c| to_fixed(c * count as f64, 4)),
        })
        .collect()
}
