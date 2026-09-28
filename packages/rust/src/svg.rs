//! SVG cutting diagram renderer.
//! The output is byte-for-byte identical to the TypeScript (svg.ts) and Python (svg.py)
//! implementations, so number formatting and text measurement are implemented by hand.

use std::collections::HashMap;

use crate::json::Value;
use crate::types::{CutType, OptimizationResult, StockResult1D, StockResult2D, StockResults};

const STYLE: &str = concat!(
    "text{font-family:sans-serif;fill:#222}",
    ".stock{fill:#e3e3e3;stroke:#555}",
    ".part{fill:#f2d7a6;stroke:#8a5a2b}",
    ".remnant{fill:#d5eed5;stroke:#3c8c3c;stroke-dasharray:4 3}",
    ".cut{stroke:#d33}",
    ".stock,.part,.remnant,.cut{stroke-width:1px;vector-effect:non-scaling-stroke}",
    ".label{text-anchor:middle;dominant-baseline:central}",
    ".remnant-label{fill:#2e6b2e}",
    ".title{font-weight:bold}",
);

/// Size (mm) the text scale is based on when no stock was used (e.g. every part is unplaced).
const FALLBACK_BASE_SIZE: f64 = 900.0;

/// Labels smaller than this fraction of the base font size are dropped.
const MIN_LABEL_RATIO: f64 = 0.35;

/// Formats a number with at most `digits` decimals (half-up), without trailing zeros.
pub fn fmt(value: f64, digits: u32) -> String {
    let scale = 10f64.powi(digits as i32);
    let n = (value * scale + 0.5).floor();
    let sign = if n < 0.0 { "-" } else { "" };
    let abs = n.abs() as u64;
    let scale_int = 10u64.pow(digits);
    let int_part = abs / scale_int;
    let frac = format!("{:0width$}", abs % scale_int, width = digits as usize);
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() {
        format!("{}{}", sign, int_part)
    } else {
        format!("{}{}.{}", sign, int_part, frac)
    }
}

fn f2(value: f64) -> String {
    fmt(value, 2)
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Approximate text width in em (ASCII 0.6em, others 1em).
fn text_width_em(text: &str) -> f64 {
    let mut width = 0.0;
    for ch in text.chars() {
        width += if (ch as u32) > 0x7f { 1.0 } else { 0.6 };
    }
    width
}

/// Renders centered, multi-line label text that fits inside a w x h box.
/// Falls back to the last line only, then to no label, when the box is too small.
fn render_label(
    lines: &[String],
    cx: f64,
    cy: f64,
    w: f64,
    h: f64,
    base_font_size: f64,
    class_name: &str,
) -> String {
    let candidates: Vec<&[String]> = if lines.len() > 1 {
        vec![lines, &lines[lines.len() - 1..]]
    } else {
        vec![lines]
    };
    for candidate in candidates {
        let max_em = candidate
            .iter()
            .map(|l| text_width_em(l))
            .fold(f64::NEG_INFINITY, f64::max);
        let font_size = base_font_size
            .min((h * 0.9) / (candidate.len() as f64 * 1.2))
            .min((w * 0.9) / max_em);
        if font_size < base_font_size * MIN_LABEL_RATIO {
            continue;
        }
        let tspans: String = candidate
            .iter()
            .enumerate()
            .map(|(i, line)| {
                let y = cy + (i as f64 - (candidate.len() as f64 - 1.0) / 2.0) * font_size * 1.2;
                format!(
                    "<tspan x=\"{}\" y=\"{}\">{}</tspan>",
                    f2(cx),
                    f2(y),
                    escape_xml(line)
                )
            })
            .collect();
        return format!(
            "<text class=\"{}\" font-size=\"{}\">{}</text>",
            class_name,
            f2(font_size),
            tspans
        );
    }
    String::new()
}

/// Part names from the original input (`{ "input": ... }` wrapper accepted).
fn part_name_map(input: Option<&Value>) -> HashMap<String, String> {
    let mut names = HashMap::new();
    let Some(input) = input else { return names };
    let request = input.get("input").unwrap_or(input);
    if let Some(parts) = request.get("parts").and_then(Value::as_array) {
        for p in parts {
            if let (Some(id), Some(name)) = (
                p.get("id").and_then(Value::as_str),
                p.get("name").and_then(Value::as_str),
            ) {
                if !name.is_empty() {
                    names.insert(id.to_string(), name.to_string());
                }
            }
        }
    }
    names
}

fn part_label<'a>(names: &'a HashMap<String, String>, part_id: &'a str) -> &'a str {
    names.get(part_id).map(String::as_str).unwrap_or(part_id)
}

/// Per-stock data for the diagram: title fields and the rendered drawing.
struct StockDrawing<'a> {
    index: usize,
    stock_id: &'a str,
    placement_count: usize,
    used_measure: f64,
    stock_measure: f64,
    size_text: String,
    draw_height: f64,
    elements: Vec<String>,
}

/// Renders an optimization result as a single SVG document with one diagram per used stock.
/// Pass the original input to label parts with their names.
pub fn render_svg(result: &OptimizationResult, input: Option<&Value>) -> String {
    let names = part_name_map(input);

    let mut max_width: f64 = 0.0;
    let mut max_height: f64 = 0.0;
    match &result.stocks {
        StockResults::TwoD(stocks) => {
            for s in stocks {
                max_width = max_width.max(s.width);
                max_height = max_height.max(s.height);
            }
        }
        StockResults::OneD(stocks) => {
            for s in stocks {
                max_width = max_width.max(s.length);
            }
        }
    }
    let max_dimension = max_width.max(max_height);
    let base_size = if max_dimension > 0.0 {
        max_dimension
    } else {
        FALLBACK_BASE_SIZE
    };
    let font_size: f64 = f2(base_size / 45.0).parse().unwrap_or(20.0);
    let margin = font_size;
    let bar_height = font_size * 3.5;

    let mut body: Vec<String> = Vec::new();
    let mut cursor = margin;
    let mut content_width = max_width;
    let mut add_title = |body: &mut Vec<String>, cursor: f64, text: &str, class_name: &str| {
        let class_attr = if class_name.is_empty() {
            String::new()
        } else {
            format!(" class=\"{}\"", class_name)
        };
        body.push(format!(
            "<text{} x=\"{}\" y=\"{}\" font-size=\"{}\">{}</text>",
            class_attr,
            f2(margin),
            f2(cursor + font_size),
            f2(font_size),
            escape_xml(text)
        ));
        content_width = content_width.max(text_width_em(text) * font_size);
    };

    // Overall summary
    let s = &result.summary;
    let unplaced_count: usize = result.unplaced_parts.iter().map(|u| u.quantity).sum();
    let mut summary_text = format!(
        "{} · yield {}% · stocks {} · parts {}/{}",
        result.dimension(),
        fmt(s.yield_rate * 100.0, 1),
        s.stock_count_used,
        s.parts_placed,
        s.parts_total
    );
    if unplaced_count > 0 {
        summary_text.push_str(&format!(" · unplaced {}", unplaced_count));
    }
    add_title(&mut body, cursor, &summary_text, "title");
    cursor += font_size * 2.0;

    let stock_drawings: Vec<StockDrawing> = match &result.stocks {
        StockResults::TwoD(stocks) => stocks
            .iter()
            .map(|st| {
                let mut used = 0.0;
                for p in &st.placements {
                    used += p.width * p.height;
                }
                StockDrawing {
                    index: st.index,
                    stock_id: st.stock_id.as_str(),
                    placement_count: st.placements.len(),
                    used_measure: used,
                    stock_measure: st.width * st.height,
                    size_text: format!("{}×{}", f2(st.width), f2(st.height)),
                    draw_height: st.height,
                    elements: render_2d_stock(st, &names, font_size),
                }
            })
            .collect(),
        StockResults::OneD(stocks) => stocks
            .iter()
            .map(|st| {
                let mut used = 0.0;
                for p in &st.placements {
                    used += p.length;
                }
                StockDrawing {
                    index: st.index,
                    stock_id: st.stock_id.as_str(),
                    placement_count: st.placements.len(),
                    used_measure: used,
                    stock_measure: st.length,
                    size_text: f2(st.length),
                    draw_height: bar_height,
                    elements: render_1d_stock(st, &names, font_size, bar_height),
                }
            })
            .collect(),
    };

    for d in stock_drawings {
        let ox = margin;
        let stock_yield = if d.stock_measure > 0.0 {
            (d.used_measure / d.stock_measure) * 100.0
        } else {
            0.0
        };
        let title_text = format!(
            "#{} {} {} · parts {} · yield {}%",
            d.index + 1,
            d.stock_id,
            d.size_text,
            d.placement_count,
            fmt(stock_yield, 1)
        );
        add_title(&mut body, cursor, &title_text, "title");
        cursor += font_size * 1.6;
        let oy = cursor;

        body.push(format!(
            "<g transform=\"translate({} {})\">",
            f2(ox),
            f2(oy)
        ));
        body.extend(d.elements);
        body.push("</g>".to_string());

        cursor += d.draw_height + font_size * 1.5;
    }

    if !result.unplaced_parts.is_empty() {
        let text = format!(
            "unplaced: {}",
            result
                .unplaced_parts
                .iter()
                .map(|u| format!("{} ×{}", part_label(&names, &u.part_id), u.quantity))
                .collect::<Vec<_>>()
                .join(", ")
        );
        add_title(&mut body, cursor, &text, "");
        cursor += font_size * 1.6;
    }

    let width = content_width + margin * 2.0;
    let height = cursor + margin;
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {} {}\"><style>{}</style><rect width=\"100%\" height=\"100%\" fill=\"#fff\"/>{}</svg>\n",
        f2(width),
        f2(height),
        STYLE,
        body.concat()
    )
}

fn render_2d_stock(
    stock: &StockResult2D,
    names: &HashMap<String, String>,
    font_size: f64,
) -> Vec<String> {
    let mut out = vec![format!(
        "<rect class=\"stock\" width=\"{}\" height=\"{}\"/>",
        f2(stock.width),
        f2(stock.height)
    )];

    for r in &stock.remnants {
        out.push(format!(
            "<rect class=\"remnant\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"><title>remnant {}×{}</title></rect>",
            f2(r.x),
            f2(r.y),
            f2(r.width),
            f2(r.height),
            f2(r.width),
            f2(r.height)
        ));
        out.push(render_label(
            &[format!("{}×{}", f2(r.width), f2(r.height))],
            r.x + r.width / 2.0,
            r.y + r.height / 2.0,
            r.width,
            r.height,
            font_size,
            "label remnant-label",
        ));
    }

    for p in &stock.placements {
        let name = part_label(names, &p.part_id);
        let dims = format!(
            "{}×{}{}",
            f2(p.width),
            f2(p.height),
            if p.rotated { " ↻" } else { "" }
        );
        out.push(format!(
            "<rect class=\"part\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"><title>{}</title></rect>",
            f2(p.x),
            f2(p.y),
            f2(p.width),
            f2(p.height),
            escape_xml(&format!("{} ({}) {}", name, p.part_id, dims))
        ));
        out.push(render_label(
            &[name.to_string(), dims],
            p.x + p.width / 2.0,
            p.y + p.height / 2.0,
            p.width,
            p.height,
            font_size,
            "label",
        ));
    }

    for c in &stock.cuts {
        let offset = c.kerf / 2.0;
        let (x1, y1, x2, y2) = match c.cut_type {
            CutType::Horizontal => (c.x, c.y + offset, c.x + c.length, c.y + offset),
            CutType::Vertical => (c.x + offset, c.y, c.x + offset, c.y + c.length),
        };
        out.push(format!(
            "<line class=\"cut\" x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\"><title>cut {}</title></line>",
            f2(x1),
            f2(y1),
            f2(x2),
            f2(y2),
            c.step
        ));
    }
    out
}

fn render_1d_stock(
    stock: &StockResult1D,
    names: &HashMap<String, String>,
    font_size: f64,
    bar_height: f64,
) -> Vec<String> {
    let mut out = vec![format!(
        "<rect class=\"stock\" width=\"{}\" height=\"{}\"/>",
        f2(stock.length),
        f2(bar_height)
    )];

    for r in &stock.remnants {
        out.push(format!(
            "<rect class=\"remnant\" x=\"{}\" width=\"{}\" height=\"{}\"><title>remnant {}</title></rect>",
            f2(r.x),
            f2(r.length),
            f2(bar_height),
            f2(r.length)
        ));
        out.push(render_label(
            &[f2(r.length)],
            r.x + r.length / 2.0,
            bar_height / 2.0,
            r.length,
            bar_height,
            font_size,
            "label remnant-label",
        ));
    }

    for p in &stock.placements {
        let name = part_label(names, &p.part_id);
        let dims = f2(p.length);
        out.push(format!(
            "<rect class=\"part\" x=\"{}\" width=\"{}\" height=\"{}\"><title>{}</title></rect>",
            f2(p.x),
            f2(p.length),
            f2(bar_height),
            escape_xml(&format!("{} ({}) {}", name, p.part_id, dims))
        ));
        out.push(render_label(
            &[name.to_string(), dims],
            p.x + p.length / 2.0,
            bar_height / 2.0,
            p.length,
            bar_height,
            font_size,
            "label",
        ));
    }

    for c in &stock.cuts {
        let x = c.x + c.kerf / 2.0;
        out.push(format!(
            "<line class=\"cut\" x1=\"{}\" y1=\"0\" x2=\"{}\" y2=\"{}\"><title>cut {}</title></line>",
            f2(x),
            f2(x),
            f2(bar_height),
            c.step
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_numbers_half_up_without_trailing_zeros() {
        assert_eq!(fmt(910.0, 2), "910");
        assert_eq!(fmt(40.444, 2), "40.44");
        assert_eq!(fmt(0.125, 2), "0.13");
        assert_eq!(fmt(77.899999, 1), "77.9");
        assert_eq!(fmt(0.5, 2), "0.5");
    }

    #[test]
    fn escapes_xml() {
        assert_eq!(
            escape_xml("Top & <Side> \"'"),
            "Top &amp; &lt;Side&gt; &quot;&apos;"
        );
    }
}
