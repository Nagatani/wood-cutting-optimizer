//! Tests over the shared scenarios in test-cases/ (the same ones the TypeScript and Python
//! test suites use) plus validation and the typed API.

use std::path::PathBuf;

use wood_cutting_optimizer::{
    json, optimize, optimize_json, optimize_request, render_svg, InputRequest, MinRemnantSize,
    Part1D, Stock1D, StockResults, Value,
};

fn test_cases() -> Vec<(String, Value)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("test-cases directory")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|p| {
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            (
                name,
                json::parse(&std::fs::read_to_string(&p).unwrap()).unwrap(),
            )
        })
        .collect()
}

#[test]
fn shared_cases_meet_expectations_and_invariants() {
    let cases = test_cases();
    assert!(!cases.is_empty());
    for (name, case) in cases {
        let result = optimize(&case).unwrap_or_else(|e| panic!("{}: {}", name, e));
        let s = &result.summary;

        // used + waste + remnant == stock
        let total = s.total_used_measure + s.total_waste_measure + s.total_remnant_measure;
        assert!(
            (total - s.total_stock_measure).abs() < 1e-3,
            "{}: balance {} vs {}",
            name,
            total,
            s.total_stock_measure
        );

        // Purchase list adds up
        let usage: usize = s.stock_usage.iter().map(|u| u.quantity).sum();
        assert_eq!(usage, s.stock_count_used, "{}", name);

        let expected = case.get("expected").unwrap();
        if let Some(max) = expected.get("max_stocks_used").and_then(Value::as_f64) {
            assert!(
                s.stock_count_used as f64 <= max,
                "{}: used {} > {}",
                name,
                s.stock_count_used,
                max
            );
        }
        if let Some(Value::Bool(all_placed)) = expected.get("all_placed") {
            assert_eq!(result.unplaced_parts.is_empty(), *all_placed, "{}", name);
        }

        // Output JSON round-trips and the SVG draws every placement
        let value = result.to_value();
        assert_eq!(
            wood_cutting_optimizer::OptimizationResult::from_value(&value).unwrap(),
            result
        );
        let svg = render_svg(&result, Some(&case));
        let placements = match &result.stocks {
            StockResults::OneD(stocks) => stocks.iter().map(|s| s.placements.len()).sum::<usize>(),
            StockResults::TwoD(stocks) => stocks.iter().map(|s| s.placements.len()).sum::<usize>(),
        };
        assert_eq!(
            svg.matches("<rect class=\"part\"").count(),
            placements,
            "{}",
            name
        );
    }
}

#[test]
fn guillotine_placements_do_not_overlap() {
    for (name, case) in test_cases() {
        let result = optimize(&case).unwrap();
        if let StockResults::TwoD(stocks) = &result.stocks {
            for stock in stocks {
                for (i, a) in stock.placements.iter().enumerate() {
                    assert!(a.x >= -1e-6 && a.y >= -1e-6, "{}", name);
                    assert!(
                        a.x + a.width <= stock.width + 1e-6
                            && a.y + a.height <= stock.height + 1e-6,
                        "{}",
                        name
                    );
                    for b in &stock.placements[i + 1..] {
                        let ox = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
                        let oy = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
                        assert!(
                            ox <= 1e-6 || oy <= 1e-6,
                            "{}: overlap {} / {}",
                            name,
                            a.part_id,
                            b.part_id
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn rejects_invalid_input_with_the_same_messages() {
    let cases = [
        (
            r#"{"dimension":"3D","stocks":[],"parts":[]}"#,
            r#"dimension must be "1D" or "2D" (got 3D)"#,
        ),
        (
            r#"{"dimension":"1D","stocks":[],"parts":[{"id":"p","length":1}]}"#,
            "stocks must contain at least one stock",
        ),
        (
            r#"{"dimension":"1D","stocks":[{"id":"s","length":-5}],"parts":[{"id":"p","length":1}]}"#,
            "stocks[0].length must be a finite number > 0 (got -5)",
        ),
        (
            r#"{"dimension":"1D","stocks":[{"id":"s","length":10}],"parts":[{"id":"p","length":1,"quantity":2.5}]}"#,
            "parts[0].quantity must be an integer >= 1 (got 2.5)",
        ),
        (
            r#"{"dimension":"1D","stocks":[{"id":"s","length":10}],"parts":[{"id":"p","length":1,"quantity":"unlimited"}]}"#,
            "parts[0].quantity must be an integer >= 1 (got unlimited)",
        ),
        (
            r#"{"dimension":"1D","stocks":[{"id":"s","length":10},{"id":"s","length":20}],"parts":[{"id":"p","length":1}]}"#,
            r#"stocks[1].id "s" is duplicated (ids must be unique)"#,
        ),
        (
            r#"{"dimension":"1D","stocks":[{"id":"s","length":10,"trim":5}],"parts":[{"id":"p","length":1}]}"#,
            "stocks[0].trim leaves no usable material (trim 5 on each edge of 10)",
        ),
        (
            r#"{"dimension":"2D","stocks":[{"id":"s","width":10,"height":10,"grain":"diag"}],"parts":[{"id":"p","width":1,"height":1}]}"#,
            "stocks[0].grain must be one of none, length, width (got diag)",
        ),
        (
            r#"{"dimension":"2D","stocks":[{"id":"s","width":10,"height":10}],"parts":[{"id":"p","width":1,"height":1,"can_rotate":"yes"}]}"#,
            "parts[0].can_rotate must be a boolean (got yes)",
        ),
        (r#"{"input": 5}"#, "input must be an object"),
    ];
    for (input, message) in cases {
        let err = optimize(&json::parse(input).unwrap()).unwrap_err();
        assert_eq!(err, format!("Invalid input: {}", message), "{}", input);
    }
}

#[test]
fn optimize_json_matches_to_value() {
    let text = r#"{"dimension":"1D","kerf":3,"stocks":[{"id":"s","length":1820,"quantity":"unlimited"}],"parts":[{"id":"a","length":900,"quantity":20}]}"#;
    let pretty = optimize_json(text).unwrap();
    let result = optimize(&json::parse(text).unwrap()).unwrap();
    assert_eq!(pretty, result.to_value().to_pretty_string());
    assert_eq!(result.summary.stock_count_used, 10);
}

#[test]
fn typed_requests_are_validated_and_optimized() {
    let request = InputRequest::OneD {
        kerf: 3.0,
        min_remnant_size: MinRemnantSize {
            length: Some(100.0),
            ..Default::default()
        },
        stocks: vec![Stock1D {
            id: "s".into(),
            length: 1000.0,
            quantity: 1.0,
            cost: None,
            trim: 10.0,
        }],
        parts: vec![Part1D {
            id: "a".into(),
            name: None,
            length: 400.0,
            quantity: 1,
        }],
    };
    let result = optimize_request(&request).unwrap();
    let StockResults::OneD(stocks) = &result.stocks else {
        panic!("expected a 1D result")
    };
    assert_eq!(stocks[0].placements[0].x, 10.0);
    assert_eq!(stocks[0].remnants[0].x, 413.0);
    assert_eq!(result.summary.total_waste_measure, 23.0);

    let invalid = InputRequest::OneD {
        kerf: -1.0,
        min_remnant_size: MinRemnantSize::default(),
        stocks: vec![Stock1D {
            id: "s".into(),
            length: 1000.0,
            quantity: 1.0,
            cost: None,
            trim: 0.0,
        }],
        parts: vec![Part1D {
            id: "a".into(),
            name: None,
            length: 400.0,
            quantity: 1,
        }],
    };
    assert!(optimize_request(&invalid)
        .unwrap_err()
        .starts_with("Invalid input: kerf"));
}
