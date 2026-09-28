#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { optimize, renderSvg } from '../src/index.js';

const HELP = `
Wood Cutting Optimizer CLI (TypeScript)

Usage:
  wood-cutting-optimizer --input <path-to-json> [--output <path-to-json>] [--svg <path-to-svg>]
  wood-cutting-optimizer <path-to-json>

Options:
  -i, --input <file>    Path to input JSON file
  -o, --output <file>   Path to output JSON file (defaults to stdout)
      --svg <file>      Also write an SVG cutting diagram to this file
  -h, --help            Show this help message
`;

/** Exit code for command line usage errors (same as Python's argparse). */
const USAGE_ERROR = 2;

class UsageError extends Error {}

interface CliArgs {
  inputPath?: string;
  outputPath?: string;
  svgPath?: string;
  help?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  const takeValue = (i: number, option: string): string => {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new UsageError(`option ${option} requires a file path`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-i' || arg === '--input') {
      result.inputPath = takeValue(i++, arg);
    } else if (arg === '-o' || arg === '--output') {
      result.outputPath = takeValue(i++, arg);
    } else if (arg === '--svg') {
      result.svgPath = takeValue(i++, arg);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unrecognized option: ${arg}`);
    } else if (result.inputPath === undefined) {
      result.inputPath = arg;
    } else {
      throw new UsageError(`unexpected argument: ${arg}`);
    }
  }

  return result;
}

function main(): void {
  let parsed: CliArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err: any) {
    process.stderr.write(`${HELP}\nError: ${err.message}\n`);
    process.exit(USAGE_ERROR);
  }

  if (parsed.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (!parsed.inputPath) {
    process.stderr.write(HELP);
    process.exit(1);
  }

  const resolvedInputPath = path.resolve(process.cwd(), parsed.inputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    console.error(`Error: Input file not found at ${resolvedInputPath}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(resolvedInputPath, 'utf-8');
    const inputJson = JSON.parse(content);

    // optimize() accepts both direct input and test case structure ({ input: ... })
    const result = optimize(inputJson);
    const jsonOutput = JSON.stringify(result, null, 2);

    if (parsed.svgPath) {
      const resolvedSvgPath = path.resolve(process.cwd(), parsed.svgPath);
      fs.writeFileSync(resolvedSvgPath, renderSvg(result, inputJson), 'utf-8');
      console.error(`SVG cutting diagram written to ${resolvedSvgPath}`);
    }

    if (parsed.outputPath) {
      const resolvedOutputPath = path.resolve(process.cwd(), parsed.outputPath);
      fs.writeFileSync(resolvedOutputPath, jsonOutput, 'utf-8');
      console.error(`Optimization result written to ${resolvedOutputPath}`);
    } else {
      console.log(jsonOutput);
    }
  } catch (err: any) {
    console.error(`Optimization failed: ${err.message}`);
    process.exit(1);
  }
}

main();
