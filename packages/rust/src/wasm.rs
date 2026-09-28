//! WebAssembly bindings (enabled with the `wasm` feature; build with `wasm-pack`).
//!
//! JavaScript API (same shapes as the TypeScript package):
//! - `optimize(input)` → result object
//! - `optimizeJson(inputJson)` → result JSON string
//! - `renderSvg(result, input?)` → SVG string

use wasm_bindgen::prelude::*;

use crate::json::{self, Value};
use crate::types::OptimizationResult;

fn to_json_text(value: &JsValue) -> Result<String, JsError> {
    js_sys::JSON::stringify(value)
        .ok()
        .and_then(|s| s.as_string())
        .ok_or_else(|| JsError::new("Invalid input: input must be an object"))
}

fn parse_js(value: &JsValue) -> Result<Value, JsError> {
    json::parse(&to_json_text(value)?).map_err(|e| JsError::new(&e))
}

/// Optimizes an input object (`specification/schema.json`, the `{ input }` wrapper is accepted)
/// and returns the result object.
#[wasm_bindgen]
pub fn optimize(input: JsValue) -> Result<JsValue, JsError> {
    let result = crate::optimize(&parse_js(&input)?).map_err(|e| JsError::new(&e))?;
    js_sys::JSON::parse(&result.to_value().to_compact_string())
        .map_err(|_| JsError::new("failed to build the result"))
}

/// Optimizes an input JSON string and returns the result as pretty-printed JSON.
#[wasm_bindgen(js_name = optimizeJson)]
pub fn optimize_json(input: &str) -> Result<String, JsError> {
    crate::optimize_json(input).map_err(|e| JsError::new(&e))
}

/// Renders a result (from `optimize`) as an SVG cutting diagram.
/// Pass the original input to label parts with their names.
#[wasm_bindgen(js_name = renderSvg)]
pub fn render_svg(result: JsValue, input: JsValue) -> Result<String, JsError> {
    let result =
        OptimizationResult::from_value(&parse_js(&result)?).map_err(|e| JsError::new(&e))?;
    let input = if input.is_undefined() || input.is_null() {
        None
    } else {
        Some(parse_js(&input)?)
    };
    Ok(crate::render_svg(&result, input.as_ref()))
}

/// Library version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
