//! Command line interface. Options, output and exit codes match the TypeScript and Python CLIs:
//! 0 on success, 1 on missing input / invalid input, 2 on command line usage errors.

use std::path::{Path, PathBuf};
use std::process::exit;

use wood_cutting_optimizer::{json, optimize, render_svg};

const HELP: &str = "
Wood Cutting Optimizer CLI (Rust)

Usage:
  wood-cutting-optimizer --input <path-to-json> [--output <path-to-json>] [--svg <path-to-svg>]
  wood-cutting-optimizer <path-to-json>

Options:
  -i, --input <file>    Path to input JSON file
  -o, --output <file>   Path to output JSON file (defaults to stdout)
      --svg <file>      Also write an SVG cutting diagram to this file
  -h, --help            Show this help message
";

/// Exit code for command line usage errors (same as Python's argparse).
const USAGE_ERROR: i32 = 2;

#[derive(Default)]
struct CliArgs {
    input_path: Option<String>,
    output_path: Option<String>,
    svg_path: Option<String>,
    help: bool,
}

fn parse_args(args: &[String]) -> Result<CliArgs, String> {
    let mut result = CliArgs::default();
    let take_value = |i: usize, option: &str| -> Result<String, String> {
        match args.get(i + 1) {
            Some(value) if !value.starts_with('-') => Ok(value.clone()),
            _ => Err(format!("option {} requires a file path", option)),
        }
    };

    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        match arg {
            "-h" | "--help" => result.help = true,
            "-i" | "--input" => {
                result.input_path = Some(take_value(i, arg)?);
                i += 1;
            }
            "-o" | "--output" => {
                result.output_path = Some(take_value(i, arg)?);
                i += 1;
            }
            "--svg" => {
                result.svg_path = Some(take_value(i, arg)?);
                i += 1;
            }
            _ if arg.starts_with('-') => return Err(format!("unrecognized option: {}", arg)),
            _ if result.input_path.is_none() => result.input_path = Some(arg.to_string()),
            _ => return Err(format!("unexpected argument: {}", arg)),
        }
        i += 1;
    }
    Ok(result)
}

fn resolve(path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    }
}

fn run(parsed: &CliArgs, input_path: &Path) -> Result<(), String> {
    let content = std::fs::read_to_string(input_path).map_err(|e| e.to_string())?;
    let input = json::parse(&content)?;
    // optimize() accepts both direct input and the test case structure ({ "input": ... })
    let result = optimize(&input)?;
    let json_output = result.to_value().to_pretty_string();

    if let Some(svg_path) = &parsed.svg_path {
        let svg_path = resolve(svg_path);
        std::fs::write(&svg_path, render_svg(&result, Some(&input))).map_err(|e| e.to_string())?;
        eprintln!("SVG cutting diagram written to {}", svg_path.display());
    }

    match &parsed.output_path {
        Some(output_path) => {
            let output_path = resolve(output_path);
            std::fs::write(&output_path, json_output).map_err(|e| e.to_string())?;
            eprintln!("Optimization result written to {}", output_path.display());
        }
        None => println!("{}", json_output),
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprint!("{}\nError: {}\n", HELP, message);
            exit(USAGE_ERROR);
        }
    };

    if parsed.help {
        print!("{}", HELP);
        exit(0);
    }
    let Some(input_path) = &parsed.input_path else {
        eprint!("{}", HELP);
        exit(1);
    };

    let input_path = resolve(input_path);
    if !input_path.is_file() {
        eprintln!("Error: Input file not found at {}", input_path.display());
        exit(1);
    }

    if let Err(message) = run(&parsed, &input_path) {
        eprintln!("Optimization failed: {}", message);
        exit(1);
    }
}
