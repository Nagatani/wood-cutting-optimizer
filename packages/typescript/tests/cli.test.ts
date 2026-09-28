import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../bin/cli.js');
const testCasesDir = fs.existsSync(path.resolve(__dirname, '../../../../test-cases'))
  ? path.resolve(__dirname, '../../../../test-cases')
  : path.resolve(process.cwd(), '../../test-cases');
const casePath = path.join(testCasesDir, '2d_guillotine.json');

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8' });
}

describe('CLI', () => {
  let tmpDir: string;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wco-cli-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should print the result JSON to stdout', () => {
    const res = runCli([casePath]);
    assert.strictEqual(res.status, 0, res.stderr);
    const result = JSON.parse(res.stdout);
    assert.strictEqual(result.dimension, '2D');
    assert.strictEqual(result.unplaced_parts.length, 0);
  });

  it('should write JSON and SVG files with -o and --svg', () => {
    const outPath = path.join(tmpDir, 'result.json');
    const svgPath = path.join(tmpDir, 'plan.svg');
    const res = runCli(['-i', casePath, '-o', outPath, '--svg', svgPath]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
    assert.strictEqual(JSON.parse(fs.readFileSync(outPath, 'utf-8')).dimension, '2D');
    assert.ok(fs.readFileSync(svgPath, 'utf-8').startsWith('<svg '));
  });

  it('should show help with exit code 0', () => {
    const res = runCli(['--help']);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /Usage:/);
  });

  it('should exit with 1 when no input is given', () => {
    const res = runCli([]);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /Usage:/);
  });

  const usageErrors: [string, string[]][] = [
    ['unknown option', [casePath, '--bogus']],
    ['missing --svg value', [casePath, '--svg']],
    ['missing -o value', [casePath, '-o']],
    ['option as -o value', [casePath, '-o', '--svg', 'x.svg']],
    ['extra argument', [casePath, 'extra.json']],
  ];
  for (const [label, args] of usageErrors) {
    it(`should exit with 2 on ${label}`, () => {
      const res = runCli(args);
      assert.strictEqual(res.status, 2);
      assert.match(res.stderr, /Error:/);
    });
  }

  it('should exit with 1 on a missing input file', () => {
    const res = runCli([path.join(tmpDir, 'missing.json')]);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /not found/);
  });

  it('should exit with 1 on invalid input', () => {
    const badPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badPath, JSON.stringify({ dimension: '1D', stocks: [], parts: [] }));
    const res = runCli([badPath]);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /Invalid input/);
  });
});
