import sys
import json
import argparse
from pathlib import Path
from . import optimize


def main():
    parser = argparse.ArgumentParser(
        prog="wood-opt",
        description="Wood Cutting Optimizer CLI (Python)",
    )
    parser.add_argument(
        "input_pos",
        nargs="?",
        help="Path to input JSON file",
    )
    parser.add_argument(
        "-i", "--input",
        dest="input_opt",
        help="Path to input JSON file",
    )
    parser.add_argument(
        "-o", "--output",
        help="Path to output JSON file (defaults to stdout)",
    )

    args = parser.parse_args()
    input_file = args.input_opt or args.input_pos

    if not input_file:
        parser.print_help(sys.stderr)
        sys.exit(1)

    input_path = Path(input_file).resolve()
    if not input_path.is_file():
        sys.stderr.write(f"Error: Input file not found at {input_path}\n")
        sys.exit(1)

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        result = optimize(data)
        out_json = json.dumps(result.to_dict(), indent=2, ensure_ascii=False)

        if args.output:
            out_path = Path(args.output).resolve()
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(out_json)
            sys.stderr.write(f"Optimization result written to {out_path}\n")
        else:
            print(out_json)

    except Exception as e:
        sys.stderr.write(f"Optimization failed: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
