//! Comparison of candidate solutions produced by different heuristics.

/// Metrics used to compare candidate solutions.
#[derive(Debug, Clone, PartialEq)]
pub struct SolutionEvaluation {
    /// Number of part pieces that could not be placed
    pub unplaced_count: usize,
    /// Sum of `cost` of used stocks (defaults to stock area/length)
    pub total_cost: f64,
    /// Number of stocks used
    pub stock_count: usize,
    /// Total reusable remnant area/length
    pub remnant_measure: f64,
    /// Number of cuts (less work at the saw)
    pub cut_count: usize,
}

const RELATIVE_EPS: f64 = 1e-9;

fn less_than(a: f64, b: f64) -> bool {
    a < b - RELATIVE_EPS * 1f64.max(a.abs()).max(b.abs())
}

/// Returns true when `a` is strictly better than `b`. Criteria in priority order:
/// 1. fewer unplaced parts
/// 2. lower total stock cost
/// 3. fewer stocks
/// 4. more reusable remnant
/// 5. fewer cuts
pub fn is_better_evaluation(a: &SolutionEvaluation, b: &SolutionEvaluation) -> bool {
    if a.unplaced_count != b.unplaced_count {
        return a.unplaced_count < b.unplaced_count;
    }
    if less_than(a.total_cost, b.total_cost) {
        return true;
    }
    if less_than(b.total_cost, a.total_cost) {
        return false;
    }
    if a.stock_count != b.stock_count {
        return a.stock_count < b.stock_count;
    }
    if less_than(b.remnant_measure, a.remnant_measure) {
        return true;
    }
    if less_than(a.remnant_measure, b.remnant_measure) {
        return false;
    }
    a.cut_count < b.cut_count
}
