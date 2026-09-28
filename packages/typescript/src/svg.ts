import {
  InputRequest,
  OptimizationResult,
  StockResult1D,
  StockResult2D,
} from './types.js';

/**
 * SVG cutting diagram renderer.
 * The output is byte-for-byte identical to the Python implementation (svg.py),
 * so number formatting and text measurement are implemented by hand.
 */

const STYLE =
  'text{font-family:sans-serif;fill:#222}' +
  '.stock{fill:#e3e3e3;stroke:#555}' +
  '.part{fill:#f2d7a6;stroke:#8a5a2b}' +
  '.remnant{fill:#d5eed5;stroke:#3c8c3c;stroke-dasharray:4 3}' +
  '.cut{stroke:#d33}' +
  '.stock,.part,.remnant,.cut{stroke-width:1px;vector-effect:non-scaling-stroke}' +
  '.label{text-anchor:middle;dominant-baseline:central}' +
  '.remnant-label{fill:#2e6b2e}' +
  '.title{font-weight:bold}';

/** Labels smaller than this fraction of the base font size are dropped. */
const MIN_LABEL_RATIO = 0.35;

/**
 * Formats a number with at most `digits` decimals (half-up), without trailing zeros.
 */
function fmt(value: number, digits = 2): string {
  const scale = 10 ** digits;
  const n = Math.floor(value * scale + 0.5);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const intPart = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(digits, '0').replace(/0+$/, '');
  return frac ? `${sign}${intPart}.${frac}` : `${sign}${intPart}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Approximate text width in em (ASCII 0.6em, others 1em). */
function textWidthEm(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += ch.codePointAt(0)! > 0x7f ? 1.0 : 0.6;
  }
  return width;
}

/**
 * Renders centered, multi-line label text that fits inside a w x h box.
 * Falls back to the last line only, then to no label, when the box is too small.
 */
function renderLabel(
  lines: string[],
  cx: number,
  cy: number,
  w: number,
  h: number,
  baseFontSize: number,
  className: string
): string {
  const candidates = lines.length > 1 ? [lines, lines.slice(-1)] : [lines];
  for (const candidate of candidates) {
    const maxEm = Math.max(...candidate.map(textWidthEm));
    const fontSize = Math.min(
      baseFontSize,
      (h * 0.9) / (candidate.length * 1.2),
      (w * 0.9) / maxEm
    );
    if (fontSize < baseFontSize * MIN_LABEL_RATIO) continue;
    const tspans = candidate
      .map((line, i) => {
        const y = cy + (i - (candidate.length - 1) / 2) * fontSize * 1.2;
        return `<tspan x="${fmt(cx)}" y="${fmt(y)}">${escapeXml(line)}</tspan>`;
      })
      .join('');
    return `<text class="${className}" font-size="${fmt(fontSize)}">${tspans}</text>`;
  }
  return '';
}

function partNameMap(input?: InputRequest | { input: InputRequest }): Map<string, string> {
  const names = new Map<string, string>();
  if (!input) return names;
  const request = 'input' in input ? input.input : input;
  for (const p of request.parts ?? []) {
    if (p.name) names.set(p.id, p.name);
  }
  return names;
}

function partLabel(names: Map<string, string>, partId: string): string {
  return names.get(partId) ?? partId;
}

/**
 * Renders an optimization result as a single SVG document with one diagram per used stock.
 * Pass the original input to label parts with their names.
 */
export function renderSvg(
  result: OptimizationResult,
  input?: InputRequest | { input: InputRequest }
): string {
  const names = partNameMap(input);
  const is2D = result.dimension === '2D';

  let maxWidth = 0;
  let maxHeight = 0;
  for (const stock of result.stocks) {
    if (is2D) {
      const s = stock as StockResult2D;
      maxWidth = Math.max(maxWidth, s.width);
      maxHeight = Math.max(maxHeight, s.height);
    } else {
      maxWidth = Math.max(maxWidth, (stock as StockResult1D).length);
    }
  }
  const baseSize = Math.max(maxWidth, maxHeight, 1);
  const fontSize = Number(fmt(baseSize / 45));
  const margin = fontSize;
  const barHeight = fontSize * 3.5;

  const body: string[] = [];
  let cursor = margin;
  let contentWidth = maxWidth;
  const addTitle = (text: string, className: string): void => {
    body.push(
      `<text${className ? ` class="${className}"` : ''} x="${fmt(margin)}" y="${fmt(cursor + fontSize)}" font-size="${fmt(fontSize)}">${escapeXml(text)}</text>`
    );
    contentWidth = Math.max(contentWidth, textWidthEm(text) * fontSize);
  };

  // Overall summary
  const unplacedCount = result.unplaced_parts.reduce((sum, u) => sum + u.quantity, 0);
  const summaryText =
    `${result.dimension} · yield ${fmt(result.summary.yield_rate * 100, 1)}%` +
    ` · stocks ${result.summary.stock_count_used}` +
    ` · parts ${result.summary.parts_placed}/${result.summary.parts_total}` +
    (unplacedCount > 0 ? ` · unplaced ${unplacedCount}` : '');
  addTitle(summaryText, 'title');
  cursor += fontSize * 2;

  for (const stock of result.stocks) {
    const ox = margin;
    let usedMeasure = 0;
    let stockMeasure: number;
    let sizeText: string;
    let drawHeight: number;

    if (is2D) {
      const s = stock as StockResult2D;
      stockMeasure = s.width * s.height;
      for (const p of s.placements) usedMeasure += p.width * p.height;
      sizeText = `${fmt(s.width)}×${fmt(s.height)}`;
      drawHeight = s.height;
    } else {
      const s = stock as StockResult1D;
      stockMeasure = s.length;
      for (const p of s.placements) usedMeasure += p.length;
      sizeText = fmt(s.length);
      drawHeight = barHeight;
    }

    const stockYield = stockMeasure > 0 ? (usedMeasure / stockMeasure) * 100 : 0;
    const titleText =
      `#${stock.index + 1} ${stock.stock_id} ${sizeText}` +
      ` · parts ${stock.placements.length} · yield ${fmt(stockYield, 1)}%`;
    addTitle(titleText, 'title');
    cursor += fontSize * 1.6;
    const oy = cursor;

    body.push(`<g transform="translate(${fmt(ox)} ${fmt(oy)})">`);
    if (is2D) {
      body.push(...render2DStock(stock as StockResult2D, names, fontSize));
    } else {
      body.push(...render1DStock(stock as StockResult1D, names, fontSize, barHeight));
    }
    body.push('</g>');

    cursor += drawHeight + fontSize * 1.5;
  }

  if (result.unplaced_parts.length > 0) {
    const text =
      'unplaced: ' +
      result.unplaced_parts.map((u) => `${partLabel(names, u.part_id)} ×${u.quantity}`).join(', ');
    addTitle(text, '');
    cursor += fontSize * 1.6;
  }

  const width = contentWidth + margin * 2;
  const height = cursor + margin;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}">` +
    `<style>${STYLE}</style>` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    body.join('') +
    '</svg>\n'
  );
}

function render2DStock(stock: StockResult2D, names: Map<string, string>, fontSize: number): string[] {
  const out: string[] = [];
  out.push(`<rect class="stock" width="${fmt(stock.width)}" height="${fmt(stock.height)}"/>`);

  for (const r of stock.remnants) {
    out.push(
      `<rect class="remnant" x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.width)}" height="${fmt(r.height)}">` +
        `<title>remnant ${fmt(r.width)}×${fmt(r.height)}</title></rect>`
    );
    out.push(
      renderLabel([`${fmt(r.width)}×${fmt(r.height)}`], r.x + r.width / 2, r.y + r.height / 2, r.width, r.height, fontSize, 'label remnant-label')
    );
  }

  for (const p of stock.placements) {
    const name = partLabel(names, p.part_id);
    const dims = `${fmt(p.width)}×${fmt(p.height)}${p.rotated ? ' ↻' : ''}`;
    out.push(
      `<rect class="part" x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.width)}" height="${fmt(p.height)}">` +
        `<title>${escapeXml(`${name} (${p.part_id}) ${dims}`)}</title></rect>`
    );
    out.push(renderLabel([name, dims], p.x + p.width / 2, p.y + p.height / 2, p.width, p.height, fontSize, 'label'));
  }

  for (const c of stock.cuts) {
    const offset = c.kerf / 2;
    const [x1, y1, x2, y2] =
      c.type === 'horizontal'
        ? [c.x, c.y + offset, c.x + c.length, c.y + offset]
        : [c.x + offset, c.y, c.x + offset, c.y + c.length];
    out.push(
      `<line class="cut" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"><title>cut ${c.step}</title></line>`
    );
  }
  return out;
}

function render1DStock(
  stock: StockResult1D,
  names: Map<string, string>,
  fontSize: number,
  barHeight: number
): string[] {
  const out: string[] = [];
  out.push(`<rect class="stock" width="${fmt(stock.length)}" height="${fmt(barHeight)}"/>`);

  for (const r of stock.remnants) {
    out.push(
      `<rect class="remnant" x="${fmt(r.x)}" width="${fmt(r.length)}" height="${fmt(barHeight)}">` +
        `<title>remnant ${fmt(r.length)}</title></rect>`
    );
    out.push(renderLabel([fmt(r.length)], r.x + r.length / 2, barHeight / 2, r.length, barHeight, fontSize, 'label remnant-label'));
  }

  for (const p of stock.placements) {
    const name = partLabel(names, p.part_id);
    const dims = fmt(p.length);
    out.push(
      `<rect class="part" x="${fmt(p.x)}" width="${fmt(p.length)}" height="${fmt(barHeight)}">` +
        `<title>${escapeXml(`${name} (${p.part_id}) ${dims}`)}</title></rect>`
    );
    out.push(renderLabel([name, dims], p.x + p.length / 2, barHeight / 2, p.length, barHeight, fontSize, 'label'));
  }

  for (const c of stock.cuts) {
    const x = c.x + c.kerf / 2;
    out.push(
      `<line class="cut" x1="${fmt(x)}" y1="0" x2="${fmt(x)}" y2="${fmt(barHeight)}"><title>cut ${c.step}</title></line>`
    );
  }
  return out;
}
