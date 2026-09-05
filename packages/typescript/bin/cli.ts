#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { optimize } from '../src/index.js';
import { InputRequest } from '../src/types.js';

function printHelp(): void {
  console.log(`
Wood Cutting Optimizer CLI (TypeScript)

Usage:
  wood-opt --input <path-to-json> [--output <path-to-json>]
  wood-opt <path-to-json>

Options:
  -i, --input <file>    Path to input JSON file
  -o, --output <file>   Path to output JSON file (defaults to stdout)
  -h, --help            Show this help message
`);
}

function parseArgs(args: string[]): { inputPath?: string; outputPath?: string; help?: boolean } {
  const result: { inputPath?: string; outputPath?: string; help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-i' || arg === '--input') {
      result.inputPath = args[++i];
    } else if (arg === '-o' || arg === '--output') {
      result.outputPath = args[++i];
    } else if (!arg.startsWith('-') && !result.inputPath) {
      result.inputPath = arg;
    }
  }

  return result;
}

function main(): void {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.help || !parsed.inputPath) {
    printHelp();
    process.exit(parsed.help ? 0 : 1);
  }

  const resolvedInputPath = path.resolve(process.cwd(), parsed.inputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    console.error(`Error: Input file not found at ${resolvedInputPath}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(resolvedInputPath, 'utf-8');
    const inputJson = JSON.parse(content);

    // Support both direct input or test case structure ({ input: ... })
    const input: InputRequest = inputJson.input ? inputJson.input : inputJson;

    const result = optimize(input);
    const jsonOutput = JSON.stringify(result, null, 2);

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
