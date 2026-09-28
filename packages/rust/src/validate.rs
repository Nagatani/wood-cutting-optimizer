//! Input validation against specification/schema.json.
//!
//! The checks and their order mirror `validateInput` in the TypeScript implementation,
//! so the same input produces the same `Invalid input: ...` message.

use crate::json::{format_number, Value};
use crate::types::{Grain, InputRequest, MinRemnantSize, Part1D, Part2D, Stock1D, Stock2D};

const GRAIN_DIRECTIONS: [&str; 3] = ["none", "length", "width"];

fn fail<T>(message: String) -> Result<T, String> {
    Err(format!("Invalid input: {}", message))
}

/// Formats a (possibly missing) value the way JavaScript's string conversion does.
fn js_display(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => format_number(*n),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => js_display(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

fn finite_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn check_positive(label: &str, value: Option<&Value>) -> Result<f64, String> {
    match finite_number(value) {
        Some(n) if n > 0.0 => Ok(n),
        _ => fail(format!(
            "{} must be a finite number > 0 (got {})",
            label,
            js_display(value)
        )),
    }
}

fn check_non_negative(label: &str, value: Option<&Value>) -> Result<f64, String> {
    match finite_number(value) {
        Some(n) if n >= 0.0 => Ok(n),
        _ => fail(format!(
            "{} must be a finite number >= 0 (got {})",
            label,
            js_display(value)
        )),
    }
}

/// Validates an optional quantity (integer >= 1) and returns it (1 when omitted).
fn check_quantity(label: &str, value: Option<&Value>) -> Result<f64, String> {
    match value {
        None => Ok(1.0),
        Some(v) => match finite_number(Some(v)) {
            Some(n) if n.fract() == 0.0 && n >= 1.0 => Ok(n),
            _ => fail(format!(
                "{}.quantity must be an integer >= 1 (got {})",
                label,
                js_display(value)
            )),
        },
    }
}

/// Stock quantities also accept "unlimited" (returned as infinity).
fn check_stock_quantity(label: &str, value: Option<&Value>) -> Result<f64, String> {
    if let Some(Value::String(s)) = value {
        if s == "unlimited" {
            return Ok(f64::INFINITY);
        }
    }
    check_quantity(label, value)
}

fn check_grain(label: &str, value: Option<&Value>) -> Result<Grain, String> {
    match value {
        None => Ok(Grain::None),
        Some(v) => match v.as_str().and_then(Grain::parse) {
            Some(grain) => Ok(grain),
            None => fail(format!(
                "{}.grain must be one of {} (got {})",
                label,
                GRAIN_DIRECTIONS.join(", "),
                js_display(value)
            )),
        },
    }
}

fn check_id(label: &str, value: Option<&Value>) -> Result<String, String> {
    match value.and_then(Value::as_str) {
        Some(s) if !s.is_empty() => Ok(s.to_string()),
        _ => fail(format!("{}.id must be a non-empty string", label)),
    }
}

/// Ids identify parts and stocks in the output, so they must be unique within each list.
fn check_unique_ids<'a, I: Iterator<Item = &'a String>>(
    list_name: &str,
    ids: I,
) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for (i, id) in ids.enumerate() {
        if !seen.insert(id) {
            return fail(format!(
                "{}[{}].id \"{}\" is duplicated (ids must be unique)",
                list_name, i, id
            ));
        }
    }
    Ok(())
}

fn check_trim(label: &str, entry: &Value, shortest: f64) -> Result<f64, String> {
    match entry.get("trim") {
        None => Ok(0.0),
        Some(v) => {
            let trim = check_non_negative(&format!("{}.trim", label), Some(v))?;
            if trim * 2.0 >= shortest {
                return fail(format!(
                    "{}.trim leaves no usable material (trim {} on each edge of {})",
                    label,
                    format_number(trim),
                    format_number(shortest)
                ));
            }
            Ok(trim)
        }
    }
}

fn part_name(entry: &Value) -> Option<String> {
    entry
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Validates an input object (already unwrapped from `{ "input": ... }`) and converts it
/// into a typed request.
pub fn validate_input(input: &Value) -> Result<InputRequest, String> {
    if !matches!(input, Value::Object(_) | Value::Array(_)) {
        return fail("input must be an object".to_string());
    }
    let dimension = match input.get("dimension") {
        Some(Value::String(d)) if d == "1D" || d == "2D" => d.clone(),
        other => {
            return fail(format!(
                "dimension must be \"1D\" or \"2D\" (got {})",
                js_display(other)
            ))
        }
    };
    let is_1d = dimension == "1D";

    let kerf = match input.get("kerf") {
        None => 0.0,
        Some(v) => check_non_negative("kerf", Some(v))?,
    };

    let mut min_remnant_size = MinRemnantSize::default();
    if let Some(mrs) = input.get("min_remnant_size") {
        for key in ["length", "width", "height"] {
            if let Some(v) = mrs.get(key) {
                let n = check_non_negative(&format!("min_remnant_size.{}", key), Some(v))?;
                match key {
                    "length" => min_remnant_size.length = Some(n),
                    "width" => min_remnant_size.width = Some(n),
                    _ => min_remnant_size.height = Some(n),
                }
            }
        }
    }

    let stock_values = match input.get("stocks").and_then(Value::as_array) {
        Some(items) => items,
        None => return fail("stocks must be an array".to_string()),
    };
    let part_values = match input.get("parts").and_then(Value::as_array) {
        Some(items) => items,
        None => return fail("parts must be an array".to_string()),
    };
    if stock_values.is_empty() {
        return fail("stocks must contain at least one stock".to_string());
    }
    if part_values.is_empty() {
        return fail("parts must contain at least one part".to_string());
    }

    if is_1d {
        let mut stocks = Vec::new();
        for (i, s) in stock_values.iter().enumerate() {
            let label = format!("stocks[{}]", i);
            let id = check_id(&label, s.get("id"))?;
            let length = check_positive(&format!("{}.length", label), s.get("length"))?;
            let quantity = check_stock_quantity(&label, s.get("quantity"))?;
            let cost = match s.get("cost") {
                None => None,
                Some(v) => Some(check_non_negative(&format!("{}.cost", label), Some(v))?),
            };
            let trim = check_trim(&label, s, length)?;
            stocks.push(Stock1D {
                id,
                length,
                quantity,
                cost,
                trim,
            });
        }
        let mut parts = Vec::new();
        for (i, p) in part_values.iter().enumerate() {
            let label = format!("parts[{}]", i);
            let id = check_id(&label, p.get("id"))?;
            let length = check_positive(&format!("{}.length", label), p.get("length"))?;
            let quantity = check_quantity(&label, p.get("quantity"))? as usize;
            parts.push(Part1D {
                id,
                name: part_name(p),
                length,
                quantity,
            });
        }
        check_unique_ids("stocks", stocks.iter().map(|s| &s.id))?;
        check_unique_ids("parts", parts.iter().map(|p| &p.id))?;
        Ok(InputRequest::OneD {
            kerf,
            min_remnant_size,
            stocks,
            parts,
        })
    } else {
        let mut stocks = Vec::new();
        for (i, s) in stock_values.iter().enumerate() {
            let label = format!("stocks[{}]", i);
            let id = check_id(&label, s.get("id"))?;
            let width = check_positive(&format!("{}.width", label), s.get("width"))?;
            let height = check_positive(&format!("{}.height", label), s.get("height"))?;
            let grain = check_grain(&label, s.get("grain"))?;
            let quantity = check_stock_quantity(&label, s.get("quantity"))?;
            let cost = match s.get("cost") {
                None => None,
                Some(v) => Some(check_non_negative(&format!("{}.cost", label), Some(v))?),
            };
            let trim = check_trim(&label, s, width.min(height))?;
            stocks.push(Stock2D {
                id,
                width,
                height,
                quantity,
                cost,
                trim,
                grain,
            });
        }
        let mut parts = Vec::new();
        for (i, p) in part_values.iter().enumerate() {
            let label = format!("parts[{}]", i);
            let id = check_id(&label, p.get("id"))?;
            let width = check_positive(&format!("{}.width", label), p.get("width"))?;
            let height = check_positive(&format!("{}.height", label), p.get("height"))?;
            let grain = check_grain(&label, p.get("grain"))?;
            let can_rotate = match p.get("can_rotate") {
                None => true,
                Some(Value::Bool(b)) => *b,
                other => {
                    return fail(format!(
                        "{}.can_rotate must be a boolean (got {})",
                        label,
                        js_display(other)
                    ))
                }
            };
            let quantity = check_quantity(&label, p.get("quantity"))? as usize;
            parts.push(Part2D {
                id,
                name: part_name(p),
                width,
                height,
                quantity,
                can_rotate,
                grain,
            });
        }
        check_unique_ids("stocks", stocks.iter().map(|s| &s.id))?;
        check_unique_ids("parts", parts.iter().map(|p| &p.id))?;
        Ok(InputRequest::TwoD {
            kerf,
            min_remnant_size,
            stocks,
            parts,
        })
    }
}
