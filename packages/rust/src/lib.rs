//! # wood-cutting-optimizer
//!
//! Zero-dependency 1D (lumber) and 2D (sheet) wood cutting optimizer: saw kerf, guillotine
//! cuts, grain direction, reusable remnants, cost-aware stock selection and SVG cutting diagrams.
//!
//! This is the Rust / WebAssembly implementation. It takes the same JSON input
//! (`specification/schema.json`) and returns the same results as the TypeScript and
//! Python implementations in this repository.
//!
//! ```
//! use wood_cutting_optimizer::{json, optimize, render_svg};
//!
//! let input = json::parse(r#"{
//!     "dimension": "1D",
//!     "kerf": 3,
//!     "stocks": [{ "id": "2x4-6ft", "length": 1820, "quantity": "unlimited" }],
//!     "parts": [{ "id": "leg", "name": "Leg", "length": 800, "quantity": 4 }]
//! }"#).unwrap();
//!
//! let result = optimize(&input).unwrap();
//! assert_eq!(result.summary.stock_count_used, 2);
//! println!("{}", result.to_value().to_pretty_string());
//! let svg = render_svg(&result, Some(&input));
//! assert!(svg.starts_with("<svg"));
//! ```

pub mod binpacking;
mod evaluation;
pub mod json;
mod optimizer1d;
mod optimizer2d;
mod round;
mod svg;
pub mod types;
mod usage;
mod validate;
#[cfg(feature = "wasm")]
mod wasm;

pub use binpacking::{
    bin_pack_1d, BinDefinition, BinPacking1DOptions, BinPacking1DResult, BinSelection1D,
    ItemDefinition, PackingStrategy1D,
};
pub use json::Value;
pub use svg::render_svg;
pub use types::*;
pub use validate::validate_input;

/// Optimizes a JSON input (`specification/schema.json`). The test-case wrapper form
/// `{ "input": { ... } }` is also accepted. Invalid input returns `Err("Invalid input: ...")`.
pub fn optimize(data: &Value) -> Result<OptimizationResult, String> {
    let input = match data {
        Value::Object(_) => data.get("input").unwrap_or(data),
        _ => data,
    };
    let request = validate_input(input)?;
    optimize_request(&request)
}

/// Optimizes a JSON document and returns the result as pretty-printed JSON
/// (the same text as the TypeScript CLI prints).
pub fn optimize_json(text: &str) -> Result<String, String> {
    let value = json::parse(text)?;
    Ok(optimize(&value)?.to_value().to_pretty_string())
}

/// Optimizes an already typed request. The request is validated with the same rules as the JSON input.
pub fn optimize_request(request: &InputRequest) -> Result<OptimizationResult, String> {
    // Re-validate through the JSON representation so typed and JSON input follow one set of rules
    validate_input(&request_to_value(request))?;
    match request {
        InputRequest::OneD {
            kerf,
            min_remnant_size,
            stocks,
            parts,
        } => optimizer1d::optimize_1d(stocks, parts, *kerf, min_remnant_size),
        InputRequest::TwoD {
            kerf,
            min_remnant_size,
            stocks,
            parts,
        } => optimizer2d::optimize_2d(stocks, parts, *kerf, min_remnant_size),
    }
}

fn quantity_value(quantity: f64) -> Value {
    if quantity == f64::INFINITY {
        Value::String("unlimited".to_string())
    } else {
        Value::Number(quantity)
    }
}

fn request_to_value(request: &InputRequest) -> Value {
    let min_remnant = |m: &MinRemnantSize| {
        let mut members = Vec::new();
        for (key, v) in [
            ("length", m.length),
            ("width", m.width),
            ("height", m.height),
        ] {
            if let Some(v) = v {
                members.push((key.to_string(), Value::Number(v)));
            }
        }
        Value::Object(members)
    };
    let cost = |c: Option<f64>| c.map(Value::Number).unwrap_or(Value::Null);
    let grain = |g: Grain| {
        Value::String(
            match g {
                Grain::None => "none",
                Grain::Length => "length",
                Grain::Width => "width",
            }
            .to_string(),
        )
    };
    let strip_nulls = |v: Value| match v {
        Value::Object(members) => Value::Object(
            members
                .into_iter()
                .filter(|(_, v)| *v != Value::Null)
                .collect(),
        ),
        other => other,
    };
    match request {
        InputRequest::OneD {
            kerf,
            min_remnant_size,
            stocks,
            parts,
        } => Value::object([
            ("dimension", Value::String("1D".to_string())),
            ("kerf", Value::Number(*kerf)),
            ("min_remnant_size", min_remnant(min_remnant_size)),
            (
                "stocks",
                Value::Array(
                    stocks
                        .iter()
                        .map(|s| {
                            strip_nulls(Value::object([
                                ("id", Value::String(s.id.clone())),
                                ("length", Value::Number(s.length)),
                                ("quantity", quantity_value(s.quantity)),
                                ("cost", cost(s.cost)),
                                ("trim", Value::Number(s.trim)),
                            ]))
                        })
                        .collect(),
                ),
            ),
            (
                "parts",
                Value::Array(
                    parts
                        .iter()
                        .map(|p| {
                            Value::object([
                                ("id", Value::String(p.id.clone())),
                                ("length", Value::Number(p.length)),
                                ("quantity", Value::Number(p.quantity as f64)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ]),
        InputRequest::TwoD {
            kerf,
            min_remnant_size,
            stocks,
            parts,
        } => Value::object([
            ("dimension", Value::String("2D".to_string())),
            ("kerf", Value::Number(*kerf)),
            ("min_remnant_size", min_remnant(min_remnant_size)),
            (
                "stocks",
                Value::Array(
                    stocks
                        .iter()
                        .map(|s| {
                            strip_nulls(Value::object([
                                ("id", Value::String(s.id.clone())),
                                ("width", Value::Number(s.width)),
                                ("height", Value::Number(s.height)),
                                ("quantity", quantity_value(s.quantity)),
                                ("cost", cost(s.cost)),
                                ("trim", Value::Number(s.trim)),
                                ("grain", grain(s.grain)),
                            ]))
                        })
                        .collect(),
                ),
            ),
            (
                "parts",
                Value::Array(
                    parts
                        .iter()
                        .map(|p| {
                            Value::object([
                                ("id", Value::String(p.id.clone())),
                                ("width", Value::Number(p.width)),
                                ("height", Value::Number(p.height)),
                                ("quantity", Value::Number(p.quantity as f64)),
                                ("can_rotate", Value::Bool(p.can_rotate)),
                                ("grain", grain(p.grain)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ]),
    }
}
