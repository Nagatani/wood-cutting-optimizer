//! Input and output types. They follow specification/schema.json; the JSON produced by
//! `OptimizationResult::to_value` has the same key order as the TypeScript implementation.

use crate::json::Value;

/// Wood grain direction. `Length` runs along the length/height axis, `Width` along the width axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grain {
    None,
    Length,
    Width,
}

impl Grain {
    pub fn parse(s: &str) -> Option<Grain> {
        match s {
            "none" => Some(Grain::None),
            "length" => Some(Grain::Length),
            "width" => Some(Grain::Width),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MinRemnantSize {
    pub length: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stock1D {
    pub id: String,
    pub length: f64,
    /// Available quantity; `f64::INFINITY` for "unlimited".
    pub quantity: f64,
    pub cost: Option<f64>,
    /// Removed from each end before cutting (included in waste).
    pub trim: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Part1D {
    pub id: String,
    pub name: Option<String>,
    pub length: f64,
    pub quantity: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stock2D {
    pub id: String,
    pub width: f64,
    pub height: f64,
    /// Available quantity; `f64::INFINITY` for "unlimited".
    pub quantity: f64,
    pub cost: Option<f64>,
    /// Removed from each edge before cutting (included in waste).
    pub trim: f64,
    pub grain: Grain,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Part2D {
    pub id: String,
    pub name: Option<String>,
    pub width: f64,
    pub height: f64,
    pub quantity: usize,
    pub can_rotate: bool,
    pub grain: Grain,
}

/// A validated optimization request.
#[derive(Debug, Clone, PartialEq)]
pub enum InputRequest {
    OneD {
        kerf: f64,
        min_remnant_size: MinRemnantSize,
        stocks: Vec<Stock1D>,
        parts: Vec<Part1D>,
    },
    TwoD {
        kerf: f64,
        min_remnant_size: MinRemnantSize,
        stocks: Vec<Stock2D>,
        parts: Vec<Part2D>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cut1D {
    pub x: f64,
    pub kerf: f64,
    pub step: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Placement1D {
    pub part_id: String,
    pub x: f64,
    pub length: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Segment1D {
    pub x: f64,
    pub length: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StockResult1D {
    pub stock_id: String,
    pub index: usize,
    pub length: f64,
    pub placements: Vec<Placement1D>,
    pub cuts: Vec<Cut1D>,
    pub remnants: Vec<Segment1D>,
    pub waste: Vec<Segment1D>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CutType {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cut2D {
    pub cut_type: CutType,
    pub x: f64,
    pub y: f64,
    pub length: f64,
    pub kerf: f64,
    pub step: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Placement2D {
    pub part_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Rect2D {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StockResult2D {
    pub stock_id: String,
    pub index: usize,
    pub width: f64,
    pub height: f64,
    pub placements: Vec<Placement2D>,
    pub cuts: Vec<Cut2D>,
    pub remnants: Vec<Rect2D>,
    pub waste: Vec<Rect2D>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StockUsage {
    pub stock_id: String,
    pub quantity: usize,
    /// Unit cost times quantity, or None when the stock has no cost.
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub stock_count_used: usize,
    pub parts_placed: usize,
    pub parts_total: usize,
    pub total_stock_measure: f64,
    pub total_used_measure: f64,
    pub total_waste_measure: f64,
    pub total_remnant_measure: f64,
    pub yield_rate: f64,
    pub stock_usage: Vec<StockUsage>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnplacedPart {
    pub part_id: String,
    pub quantity: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StockResults {
    OneD(Vec<StockResult1D>),
    TwoD(Vec<StockResult2D>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct OptimizationResult {
    pub summary: Summary,
    pub stocks: StockResults,
    pub unplaced_parts: Vec<UnplacedPart>,
}

fn num(n: f64) -> Value {
    Value::Number(n)
}

fn int(n: usize) -> Value {
    Value::Number(n as f64)
}

fn string(s: &str) -> Value {
    Value::String(s.to_string())
}

impl OptimizationResult {
    /// "1D" or "2D".
    pub fn dimension(&self) -> &'static str {
        match self.stocks {
            StockResults::OneD(_) => "1D",
            StockResults::TwoD(_) => "2D",
        }
    }

    /// Converts the result to JSON (same structure and key order as the TypeScript output).
    pub fn to_value(&self) -> Value {
        let s = &self.summary;
        let summary = Value::object([
            ("stock_count_used", int(s.stock_count_used)),
            ("parts_placed", int(s.parts_placed)),
            ("parts_total", int(s.parts_total)),
            ("total_stock_measure", num(s.total_stock_measure)),
            ("total_used_measure", num(s.total_used_measure)),
            ("total_waste_measure", num(s.total_waste_measure)),
            ("total_remnant_measure", num(s.total_remnant_measure)),
            ("yield_rate", num(s.yield_rate)),
            (
                "stock_usage",
                Value::Array(
                    s.stock_usage
                        .iter()
                        .map(|u| {
                            Value::object([
                                ("stock_id", string(&u.stock_id)),
                                ("quantity", int(u.quantity)),
                                ("cost", u.cost.map(num).unwrap_or(Value::Null)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ]);

        let stocks = match &self.stocks {
            StockResults::OneD(stocks) => stocks.iter().map(stock_1d_to_value).collect(),
            StockResults::TwoD(stocks) => stocks.iter().map(stock_2d_to_value).collect(),
        };

        Value::object([
            ("dimension", string(self.dimension())),
            ("summary", summary),
            ("stocks", Value::Array(stocks)),
            (
                "unplaced_parts",
                Value::Array(
                    self.unplaced_parts
                        .iter()
                        .map(|u| {
                            Value::object([
                                ("part_id", string(&u.part_id)),
                                ("quantity", int(u.quantity)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ])
    }

    /// Reads a result previously produced by `to_value` (or by the TypeScript / Python implementations).
    pub fn from_value(value: &Value) -> Result<OptimizationResult, String> {
        let dimension = field_str(value, "dimension")?;
        let summary_value = field(value, "summary")?;
        let summary = Summary {
            stock_count_used: field_usize(summary_value, "stock_count_used")?,
            parts_placed: field_usize(summary_value, "parts_placed")?,
            parts_total: field_usize(summary_value, "parts_total")?,
            total_stock_measure: field_f64(summary_value, "total_stock_measure")?,
            total_used_measure: field_f64(summary_value, "total_used_measure")?,
            total_waste_measure: field_f64(summary_value, "total_waste_measure")?,
            total_remnant_measure: field_f64(summary_value, "total_remnant_measure")?,
            yield_rate: field_f64(summary_value, "yield_rate")?,
            stock_usage: match summary_value.get("stock_usage") {
                Some(usage) => field_array(usage)?
                    .iter()
                    .map(|u| {
                        Ok(StockUsage {
                            stock_id: field_str(u, "stock_id")?.to_string(),
                            quantity: field_usize(u, "quantity")?,
                            cost: u.get("cost").and_then(Value::as_f64),
                        })
                    })
                    .collect::<Result<_, String>>()?,
                None => Vec::new(),
            },
        };

        let stock_values = field_array(field(value, "stocks")?)?;
        let stocks = match dimension {
            "1D" => StockResults::OneD(
                stock_values
                    .iter()
                    .map(stock_1d_from_value)
                    .collect::<Result<_, _>>()?,
            ),
            "2D" => StockResults::TwoD(
                stock_values
                    .iter()
                    .map(stock_2d_from_value)
                    .collect::<Result<_, _>>()?,
            ),
            other => return Err(format!("unknown dimension: {}", other)),
        };

        let unplaced_parts = field_array(field(value, "unplaced_parts")?)?
            .iter()
            .map(|u| {
                Ok(UnplacedPart {
                    part_id: field_str(u, "part_id")?.to_string(),
                    quantity: field_usize(u, "quantity")?,
                })
            })
            .collect::<Result<_, String>>()?;

        Ok(OptimizationResult {
            summary,
            stocks,
            unplaced_parts,
        })
    }
}

fn stock_1d_to_value(s: &StockResult1D) -> Value {
    let segment = |seg: &Segment1D| Value::object([("x", num(seg.x)), ("length", num(seg.length))]);
    Value::object([
        ("stock_id", string(&s.stock_id)),
        ("index", int(s.index)),
        ("length", num(s.length)),
        (
            "placements",
            Value::Array(
                s.placements
                    .iter()
                    .map(|p| {
                        Value::object([
                            ("part_id", string(&p.part_id)),
                            ("x", num(p.x)),
                            ("length", num(p.length)),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "cuts",
            Value::Array(
                s.cuts
                    .iter()
                    .map(|c| {
                        Value::object([
                            ("x", num(c.x)),
                            ("kerf", num(c.kerf)),
                            ("step", int(c.step)),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "remnants",
            Value::Array(s.remnants.iter().map(segment).collect()),
        ),
        ("waste", Value::Array(s.waste.iter().map(segment).collect())),
    ])
}

fn rect_to_value(r: &Rect2D) -> Value {
    Value::object([
        ("x", num(r.x)),
        ("y", num(r.y)),
        ("width", num(r.width)),
        ("height", num(r.height)),
    ])
}

fn stock_2d_to_value(s: &StockResult2D) -> Value {
    Value::object([
        ("stock_id", string(&s.stock_id)),
        ("index", int(s.index)),
        ("width", num(s.width)),
        ("height", num(s.height)),
        (
            "placements",
            Value::Array(
                s.placements
                    .iter()
                    .map(|p| {
                        Value::object([
                            ("part_id", string(&p.part_id)),
                            ("x", num(p.x)),
                            ("y", num(p.y)),
                            ("width", num(p.width)),
                            ("height", num(p.height)),
                            ("rotated", Value::Bool(p.rotated)),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "cuts",
            Value::Array(
                s.cuts
                    .iter()
                    .map(|c| {
                        Value::object([
                            (
                                "type",
                                string(match c.cut_type {
                                    CutType::Horizontal => "horizontal",
                                    CutType::Vertical => "vertical",
                                }),
                            ),
                            ("x", num(c.x)),
                            ("y", num(c.y)),
                            ("length", num(c.length)),
                            ("kerf", num(c.kerf)),
                            ("step", int(c.step)),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "remnants",
            Value::Array(s.remnants.iter().map(rect_to_value).collect()),
        ),
        (
            "waste",
            Value::Array(s.waste.iter().map(rect_to_value).collect()),
        ),
    ])
}

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a Value, String> {
    value
        .get(key)
        .ok_or_else(|| format!("missing field: {}", key))
}

fn field_f64(value: &Value, key: &str) -> Result<f64, String> {
    field(value, key)?
        .as_f64()
        .ok_or_else(|| format!("field {} must be a number", key))
}

fn field_usize(value: &Value, key: &str) -> Result<usize, String> {
    let n = field_f64(value, key)?;
    if n >= 0.0 && n.fract() == 0.0 {
        Ok(n as usize)
    } else {
        Err(format!("field {} must be a non-negative integer", key))
    }
}

fn field_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    field(value, key)?
        .as_str()
        .ok_or_else(|| format!("field {} must be a string", key))
}

fn field_array(value: &Value) -> Result<&Vec<Value>, String> {
    value
        .as_array()
        .ok_or_else(|| "expected an array".to_string())
}

fn stock_1d_from_value(v: &Value) -> Result<StockResult1D, String> {
    let segments = |key: &str| -> Result<Vec<Segment1D>, String> {
        field_array(field(v, key)?)?
            .iter()
            .map(|s| {
                Ok(Segment1D {
                    x: field_f64(s, "x")?,
                    length: field_f64(s, "length")?,
                })
            })
            .collect()
    };
    Ok(StockResult1D {
        stock_id: field_str(v, "stock_id")?.to_string(),
        index: field_usize(v, "index")?,
        length: field_f64(v, "length")?,
        placements: field_array(field(v, "placements")?)?
            .iter()
            .map(|p| {
                Ok(Placement1D {
                    part_id: field_str(p, "part_id")?.to_string(),
                    x: field_f64(p, "x")?,
                    length: field_f64(p, "length")?,
                })
            })
            .collect::<Result<_, String>>()?,
        cuts: field_array(field(v, "cuts")?)?
            .iter()
            .map(|c| {
                Ok(Cut1D {
                    x: field_f64(c, "x")?,
                    kerf: field_f64(c, "kerf")?,
                    step: field_usize(c, "step")?,
                })
            })
            .collect::<Result<_, String>>()?,
        remnants: segments("remnants")?,
        waste: segments("waste")?,
    })
}

fn stock_2d_from_value(v: &Value) -> Result<StockResult2D, String> {
    let rects = |key: &str| -> Result<Vec<Rect2D>, String> {
        field_array(field(v, key)?)?
            .iter()
            .map(|r| {
                Ok(Rect2D {
                    x: field_f64(r, "x")?,
                    y: field_f64(r, "y")?,
                    width: field_f64(r, "width")?,
                    height: field_f64(r, "height")?,
                })
            })
            .collect()
    };
    Ok(StockResult2D {
        stock_id: field_str(v, "stock_id")?.to_string(),
        index: field_usize(v, "index")?,
        width: field_f64(v, "width")?,
        height: field_f64(v, "height")?,
        placements: field_array(field(v, "placements")?)?
            .iter()
            .map(|p| {
                Ok(Placement2D {
                    part_id: field_str(p, "part_id")?.to_string(),
                    x: field_f64(p, "x")?,
                    y: field_f64(p, "y")?,
                    width: field_f64(p, "width")?,
                    height: field_f64(p, "height")?,
                    rotated: matches!(p.get("rotated"), Some(Value::Bool(true))),
                })
            })
            .collect::<Result<_, String>>()?,
        cuts: field_array(field(v, "cuts")?)?
            .iter()
            .map(|c| {
                Ok(Cut2D {
                    cut_type: match field_str(c, "type")? {
                        "horizontal" => CutType::Horizontal,
                        "vertical" => CutType::Vertical,
                        other => return Err(format!("unknown cut type: {}", other)),
                    },
                    x: field_f64(c, "x")?,
                    y: field_f64(c, "y")?,
                    length: field_f64(c, "length")?,
                    kerf: field_f64(c, "kerf")?,
                    step: field_usize(c, "step")?,
                })
            })
            .collect::<Result<_, String>>()?,
        remnants: rects("remnants")?,
        waste: rects("waste")?,
    })
}
