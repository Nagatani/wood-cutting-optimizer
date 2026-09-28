//! Minimal JSON parser and serializer (no dependencies).
//!
//! The serializer mirrors JavaScript's `JSON.stringify(value, null, 2)` so the CLI output
//! is byte-for-byte identical to the TypeScript implementation.

use std::fmt::Write as _;

/// A parsed JSON value. Object members keep their source order.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    /// Returns the member `key` of an object (the last one, like `JSON.parse`), or None.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&Vec<Value>> {
        match self {
            Value::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn is_object(&self) -> bool {
        matches!(self, Value::Object(_))
    }

    /// Builds an object from `(key, value)` pairs.
    pub fn object<I: IntoIterator<Item = (&'static str, Value)>>(members: I) -> Value {
        Value::Object(
            members
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        )
    }

    /// Serializes like `JSON.stringify(value, null, 2)`.
    pub fn to_pretty_string(&self) -> String {
        let mut out = String::new();
        write_value(&mut out, self, 0);
        out
    }

    /// Serializes like `JSON.stringify(value)`.
    pub fn to_compact_string(&self) -> String {
        let mut out = String::new();
        write_compact(&mut out, self);
        out
    }
}

/// Formats a number like JavaScript's `Number.prototype.toString` for the values used here
/// (shortest round-trip representation, integers without a decimal point).
pub fn format_number(n: f64) -> String {
    if !n.is_finite() {
        return "null".to_string(); // JSON.stringify writes NaN / Infinity as null
    }
    if n == 0.0 {
        return "0".to_string(); // Also covers -0
    }
    let abs = n.abs();
    if (1e-6..1e21).contains(&abs) {
        return format!("{}", n);
    }
    // JavaScript switches to exponent notation outside [1e-6, 1e21)
    let s = format!("{:e}", n);
    let (mantissa, exponent) = s.split_once('e').unwrap_or((&s, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let sign = if exponent < 0 { "-" } else { "+" };
    format!("{}e{}{}", mantissa, sign, exponent.abs())
}

fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_value(out: &mut String, value: &Value, indent: usize) {
    match value {
        Value::Array(items) if !items.is_empty() => {
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                push_indent(out, indent + 1);
                write_value(out, item, indent + 1);
                out.push_str(if i + 1 < items.len() { ",\n" } else { "\n" });
            }
            push_indent(out, indent);
            out.push(']');
        }
        Value::Object(members) if !members.is_empty() => {
            out.push_str("{\n");
            for (i, (key, item)) in members.iter().enumerate() {
                push_indent(out, indent + 1);
                write_string(out, key);
                out.push_str(": ");
                write_value(out, item, indent + 1);
                out.push_str(if i + 1 < members.len() { ",\n" } else { "\n" });
            }
            push_indent(out, indent);
            out.push('}');
        }
        other => write_compact(out, other),
    }
}

fn write_compact(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&format_number(*n)),
        Value::String(s) => write_string(out, s),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_compact(out, item);
            }
            out.push(']');
        }
        Value::Object(members) => {
            out.push('{');
            for (i, (key, item)) in members.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(out, key);
                out.push(':');
                write_compact(out, item);
            }
            out.push('}');
        }
    }
}

fn push_indent(out: &mut String, indent: usize) {
    for _ in 0..indent {
        out.push_str("  ");
    }
}

/// Parses a JSON document.
pub fn parse(text: &str) -> Result<Value, String> {
    let mut parser = Parser {
        chars: text.char_indices().peekable(),
        text,
    };
    parser.skip_whitespace();
    let value = parser.parse_value()?;
    parser.skip_whitespace();
    match parser.chars.peek() {
        None => Ok(value),
        Some(&(pos, _)) => Err(format!(
            "Unexpected non-whitespace character after JSON at position {}",
            pos
        )),
    }
}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::CharIndices<'a>>,
    text: &'a str,
}

impl<'a> Parser<'a> {
    fn position(&mut self) -> usize {
        self.chars
            .peek()
            .map(|&(pos, _)| pos)
            .unwrap_or(self.text.len())
    }

    fn error<T>(&mut self, message: &str) -> Result<T, String> {
        let pos = self.position();
        Err(format!("{} at position {}", message, pos))
    }

    fn skip_whitespace(&mut self) {
        while let Some(&(_, c)) = self.chars.peek() {
            if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
                self.chars.next();
            } else {
                break;
            }
        }
    }

    fn expect_literal(&mut self, literal: &str, value: Value) -> Result<Value, String> {
        for expected in literal.chars() {
            match self.chars.next() {
                Some((_, c)) if c == expected => {}
                _ => return self.error("Unexpected token in JSON"),
            }
        }
        Ok(value)
    }

    fn parse_value(&mut self) -> Result<Value, String> {
        match self.chars.peek().map(|&(_, c)| c) {
            Some('{') => self.parse_object(),
            Some('[') => self.parse_array(),
            Some('"') => Ok(Value::String(self.parse_string()?)),
            Some('t') => self.expect_literal("true", Value::Bool(true)),
            Some('f') => self.expect_literal("false", Value::Bool(false)),
            Some('n') => self.expect_literal("null", Value::Null),
            Some(c) if c == '-' || c.is_ascii_digit() => self.parse_number(),
            Some(_) => self.error("Unexpected token in JSON"),
            None => self.error("Unexpected end of JSON input"),
        }
    }

    fn parse_object(&mut self) -> Result<Value, String> {
        self.chars.next(); // '{'
        let mut members = Vec::new();
        self.skip_whitespace();
        if let Some(&(_, '}')) = self.chars.peek() {
            self.chars.next();
            return Ok(Value::Object(members));
        }
        loop {
            self.skip_whitespace();
            if self.chars.peek().map(|&(_, c)| c) != Some('"') {
                return self.error("Expected property name in JSON");
            }
            let key = self.parse_string()?;
            self.skip_whitespace();
            match self.chars.next() {
                Some((_, ':')) => {}
                _ => return self.error("Expected ':' after property name in JSON"),
            }
            self.skip_whitespace();
            let value = self.parse_value()?;
            members.push((key, value));
            self.skip_whitespace();
            match self.chars.next() {
                Some((_, ',')) => continue,
                Some((_, '}')) => return Ok(Value::Object(members)),
                _ => return self.error("Expected ',' or '}' after property value in JSON"),
            }
        }
    }

    fn parse_array(&mut self) -> Result<Value, String> {
        self.chars.next(); // '['
        let mut items = Vec::new();
        self.skip_whitespace();
        if let Some(&(_, ']')) = self.chars.peek() {
            self.chars.next();
            return Ok(Value::Array(items));
        }
        loop {
            self.skip_whitespace();
            items.push(self.parse_value()?);
            self.skip_whitespace();
            match self.chars.next() {
                Some((_, ',')) => continue,
                Some((_, ']')) => return Ok(Value::Array(items)),
                _ => return self.error("Expected ',' or ']' after array element in JSON"),
            }
        }
    }

    fn parse_hex4(&mut self) -> Result<u32, String> {
        let mut code = 0u32;
        for _ in 0..4 {
            match self.chars.next().and_then(|(_, c)| c.to_digit(16)) {
                Some(d) => code = code * 16 + d,
                None => return self.error("Bad Unicode escape in JSON"),
            }
        }
        Ok(code)
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.chars.next(); // '"'
        let mut s = String::new();
        loop {
            match self.chars.next() {
                None => return self.error("Unterminated string in JSON"),
                Some((_, '"')) => return Ok(s),
                Some((_, '\\')) => match self.chars.next() {
                    Some((_, '"')) => s.push('"'),
                    Some((_, '\\')) => s.push('\\'),
                    Some((_, '/')) => s.push('/'),
                    Some((_, 'b')) => s.push('\u{08}'),
                    Some((_, 'f')) => s.push('\u{0c}'),
                    Some((_, 'n')) => s.push('\n'),
                    Some((_, 'r')) => s.push('\r'),
                    Some((_, 't')) => s.push('\t'),
                    Some((_, 'u')) => {
                        let code = self.parse_hex4()?;
                        let ch = if (0xD800..0xDC00).contains(&code) {
                            // Surrogate pair
                            let rest: Vec<char> = (0..2)
                                .filter_map(|_| self.chars.next().map(|(_, c)| c))
                                .collect();
                            if rest != ['\\', 'u'] {
                                return self.error("Bad Unicode escape in JSON");
                            }
                            let low = self.parse_hex4()?;
                            char::from_u32(
                                0x10000
                                    + ((code - 0xD800) << 10)
                                    + (low.wrapping_sub(0xDC00) & 0x3FF),
                            )
                        } else {
                            char::from_u32(code)
                        };
                        s.push(ch.unwrap_or('\u{FFFD}'));
                    }
                    _ => return self.error("Bad escaped character in JSON"),
                },
                Some((_, c)) if (c as u32) < 0x20 => {
                    return self.error("Bad control character in string literal in JSON")
                }
                Some((_, c)) => s.push(c),
            }
        }
    }

    fn parse_number(&mut self) -> Result<Value, String> {
        let start = self.position();
        let mut end = start;
        while let Some(&(pos, c)) = self.chars.peek() {
            if c.is_ascii_digit() || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E' {
                end = pos + c.len_utf8();
                self.chars.next();
            } else {
                break;
            }
        }
        let literal = &self.text[start..end];
        if !is_valid_json_number(literal) {
            return Err(format!("Unexpected number in JSON at position {}", start));
        }
        literal
            .parse::<f64>()
            .map(Value::Number)
            .map_err(|_| format!("Unexpected number in JSON at position {}", start))
    }
}

/// Checks the JSON number grammar: -?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?
fn is_valid_json_number(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && b[i] == b'-' {
        i += 1;
    }
    if i >= b.len() {
        return false;
    }
    if b[i] == b'0' {
        i += 1;
    } else if b[i].is_ascii_digit() {
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    } else {
        return false;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let digits = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == digits {
            return false;
        }
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let digits = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == digits {
            return false;
        }
    }
    i == b.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_serializes_like_json_stringify() {
        let v = parse(r#"{"a": [1, 2.5, -0.1e1], "b": {"c": "x\"あ\n"}, "d": [], "e": {}, "f": null, "g": true}"#).unwrap();
        assert_eq!(
            v.to_compact_string(),
            r#"{"a":[1,2.5,-1],"b":{"c":"x\"あ\n"},"d":[],"e":{},"f":null,"g":true}"#
        );
        assert_eq!(
            parse(r#"{"a":[1],"d":[]}"#).unwrap().to_pretty_string(),
            "{\n  \"a\": [\n    1\n  ],\n  \"d\": []\n}"
        );
    }

    #[test]
    fn formats_numbers_like_javascript() {
        assert_eq!(format_number(910.0), "910");
        assert_eq!(format_number(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(format_number(-0.0), "0");
        assert_eq!(format_number(1e21), "1e+21");
        assert_eq!(format_number(1.5e-7), "1.5e-7");
    }

    #[test]
    fn rejects_invalid_json() {
        for text in [
            "{bad json",
            "[1,]",
            "01",
            "1.",
            "\"unterminated",
            "{} x",
            "tru",
        ] {
            assert!(parse(text).is_err(), "{} should be rejected", text);
        }
    }

    #[test]
    fn decodes_surrogate_pairs() {
        assert_eq!(parse(r#""🪵""#).unwrap(), Value::String("🪵".to_string()));
    }
}
