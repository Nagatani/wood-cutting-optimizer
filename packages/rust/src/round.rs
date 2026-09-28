//! Rounding helpers matching `Number(x.toFixed(digits))` in the TypeScript implementation.

/// Rounds to `digits` decimals using the exact binary value of `x`
/// (the same result as JavaScript's `Number(x.toFixed(digits))` except for exact ties).
pub fn to_fixed(x: f64, digits: usize) -> f64 {
    format!("{:.*}", digits, x).parse().unwrap_or(x)
}
