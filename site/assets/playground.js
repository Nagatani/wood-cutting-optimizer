// Playground for wood-cutting-optimizer. Runs entirely in the browser with either the
// WebAssembly build (Rust) or the TypeScript build; both return identical results.

const PRESETS = [
  { file: '2d_guillotine.json', label: '2D 本棚（合板1枚）' },
  { file: '2d_unlimited_stock.json', label: '2D 購入計画（数量無制限）' },
  { file: '2d_cost_aware.json', label: '2D 費用の最小化' },
  { file: '2d_edge_trim.json', label: '2D 端の切り落とし' },
  { file: '2d_grain_rotation.json', label: '2D 木目と回転の制約' },
  { file: '2d_sheet_by_sheet.json', label: '2D 部材が多い例' },
  { file: '1d_basic.json', label: '1D 角材（脚・貫）' },
  { file: '1d_cost_aware.json', label: '1D 費用の最小化' },
];

const GRAINS = [
  { value: 'none', label: 'なし' },
  { value: 'length', label: '縦' },
  { value: 'width', label: '横' },
];

const STORAGE_KEY = 'wco-playground-input';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Engines

const engines = { ts: null, wasm: null };

async function loadEngines() {
  engines.ts = await import('../lib/ts/index.js');
  try {
    const wasm = await import('../lib/wasm/wood_cutting_optimizer.js');
    await wasm.default();
    engines.wasm = wasm;
  } catch (err) {
    // The WebAssembly build is optional (e.g. a local preview without it)
    const option = $('engine').querySelector('option[value="wasm"]');
    option.disabled = true;
    option.textContent += '（利用不可）';
    $('engine').value = 'ts';
  }
}

// ---------------------------------------------------------------------------
// Form state

let state = emptyState('2D');

function emptyState(dimension) {
  return {
    dimension,
    kerf: '3',
    minLength: '',
    minWidth: '',
    minHeight: '',
    stocks: [newStock(dimension, 1)],
    parts: [newPart(1)],
  };
}

function newStock(dimension, n) {
  return dimension === '1D'
    ? { id: `stock-${n}`, length: '1820', width: '', height: '', quantity: '', unlimited: true, cost: '', trim: '', grain: 'none' }
    : { id: `stock-${n}`, length: '', width: '910', height: '1820', quantity: '', unlimited: true, cost: '', trim: '', grain: 'none' };
}

function newPart(n) {
  return { id: `part-${n}`, name: '', length: '', width: '', height: '', quantity: '1', canRotate: true, grain: 'none' };
}

const str = (v) => (v === undefined || v === null ? '' : String(v));
const num = (s) => (String(s).trim() === '' ? undefined : Number(s));

/** Builds the optimizer input (specification/schema.json) from the form state. */
function toInput(s) {
  const input = { dimension: s.dimension };
  if (num(s.kerf) !== undefined) input.kerf = num(s.kerf);

  const min = {};
  if (s.dimension === '1D') {
    if (num(s.minLength) !== undefined) min.length = num(s.minLength);
  } else {
    if (num(s.minWidth) !== undefined) min.width = num(s.minWidth);
    if (num(s.minHeight) !== undefined) min.height = num(s.minHeight);
  }
  if (Object.keys(min).length > 0) input.min_remnant_size = min;

  input.stocks = s.stocks.map((st) => {
    const out = { id: st.id };
    if (s.dimension === '1D') {
      out.length = num(st.length);
    } else {
      out.width = num(st.width);
      out.height = num(st.height);
    }
    if (st.unlimited) out.quantity = 'unlimited';
    else if (num(st.quantity) !== undefined) out.quantity = num(st.quantity);
    if (num(st.cost) !== undefined) out.cost = num(st.cost);
    if (num(st.trim) !== undefined) out.trim = num(st.trim);
    if (s.dimension === '2D' && st.grain !== 'none') out.grain = st.grain;
    return out;
  });

  input.parts = s.parts.map((p) => {
    const out = { id: p.id };
    if (p.name.trim() !== '') out.name = p.name;
    if (s.dimension === '1D') {
      out.length = num(p.length);
    } else {
      out.width = num(p.width);
      out.height = num(p.height);
    }
    if (num(p.quantity) !== undefined) out.quantity = num(p.quantity);
    if (s.dimension === '2D') {
      if (!p.canRotate) out.can_rotate = false;
      if (p.grain !== 'none') out.grain = p.grain;
    }
    return out;
  });
  return input;
}

/** Loads an input object (optionally wrapped as { input }) into the form state. */
function fromInput(data) {
  const input = data && typeof data === 'object' && 'input' in data ? data.input : data;
  if (!input || typeof input !== 'object') throw new Error('入力は JSON オブジェクトである必要があります');
  const dimension = input.dimension === '1D' ? '1D' : '2D';
  const min = input.min_remnant_size ?? {};
  return {
    dimension,
    kerf: str(input.kerf),
    minLength: str(min.length),
    minWidth: str(min.width),
    minHeight: str(min.height),
    stocks: (Array.isArray(input.stocks) ? input.stocks : []).map((st) => ({
      id: str(st.id),
      length: str(st.length),
      width: str(st.width),
      height: str(st.height),
      quantity: st.quantity === 'unlimited' ? '' : str(st.quantity),
      unlimited: st.quantity === 'unlimited',
      cost: str(st.cost),
      trim: str(st.trim),
      grain: st.grain ?? 'none',
    })),
    parts: (Array.isArray(input.parts) ? input.parts : []).map((p) => ({
      id: str(p.id),
      name: str(p.name),
      length: str(p.length),
      width: str(p.width),
      height: str(p.height),
      quantity: str(p.quantity),
      canRotate: p.can_rotate !== false,
      grain: p.grain ?? 'none',
    })),
  };
}

// ---------------------------------------------------------------------------
// Form rendering

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function textInput(row, key, label, type = 'number') {
  return el('input', {
    type,
    value: row[key],
    'aria-label': label,
    min: type === 'number' ? '0' : undefined,
    step: 'any',
    oninput: (e) => {
      row[key] = e.target.value;
      saveState();
    },
  });
}

function checkbox(row, key, label, onchange) {
  return el('input', {
    type: 'checkbox',
    checked: row[key],
    'aria-label': label,
    onchange: (e) => {
      row[key] = e.target.checked;
      saveState();
      onchange?.();
    },
  });
}

function grainSelect(row, label) {
  const select = el(
    'select',
    {
      'aria-label': label,
      onchange: (e) => {
        row.grain = e.target.value;
        saveState();
      },
    },
    GRAINS.map((g) => el('option', { value: g.value }, g.label))
  );
  select.value = row.grain;
  return select;
}

function removeButton(list, index, label) {
  return el(
    'button',
    {
      type: 'button',
      class: 'icon',
      'aria-label': label,
      title: '削除',
      disabled: list.length <= 1,
      onclick: () => {
        list.splice(index, 1);
        renderForm();
        saveState();
      },
    },
    '×'
  );
}

function renderStocks() {
  const is1D = state.dimension === '1D';
  const head = ['ID', ...(is1D ? ['長さ'] : ['幅', '高さ']), '数量', '無制限', '単価', '切り落とし', ...(is1D ? [] : ['木目']), ''];
  const table = $('stocks-table');
  table.replaceChildren(
    el('thead', {}, el('tr', {}, head.map((h) => el('th', { class: h === '無制限' ? 'center' : '' }, h)))),
    el(
      'tbody',
      {},
      state.stocks.map((st, i) => {
        const n = i + 1;
        const qty = textInput(st, 'quantity', `原材${n} 数量`);
        qty.disabled = st.unlimited;
        qty.placeholder = st.unlimited ? '∞' : '1';
        const cells = [
          el('td', {}, textInput(st, 'id', `原材${n} ID`, 'text')),
          ...(is1D
            ? [el('td', {}, textInput(st, 'length', `原材${n} 長さ`))]
            : [el('td', {}, textInput(st, 'width', `原材${n} 幅`)), el('td', {}, textInput(st, 'height', `原材${n} 高さ`))]),
          el('td', {}, qty),
          el('td', { class: 'center' }, checkbox(st, 'unlimited', `原材${n} 数量無制限`, renderStocks)),
          el('td', {}, textInput(st, 'cost', `原材${n} 単価`)),
          el('td', {}, textInput(st, 'trim', `原材${n} 端の切り落とし幅`)),
          ...(is1D ? [] : [el('td', {}, grainSelect(st, `原材${n} 木目`))]),
          el('td', {}, removeButton(state.stocks, i, `原材${n} を削除`)),
        ];
        return el('tr', {}, cells);
      })
    )
  );
}

function renderParts() {
  const is1D = state.dimension === '1D';
  const head = ['ID', '名前', ...(is1D ? ['長さ'] : ['幅', '高さ']), '数量', ...(is1D ? [] : ['回転可', '木目']), ''];
  const table = $('parts-table');
  table.replaceChildren(
    el('thead', {}, el('tr', {}, head.map((h) => el('th', { class: h === '回転可' ? 'center' : '' }, h)))),
    el(
      'tbody',
      {},
      state.parts.map((p, i) => {
        const n = i + 1;
        const qty = textInput(p, 'quantity', `部材${n} 数量`);
        qty.placeholder = '1';
        const cells = [
          el('td', {}, textInput(p, 'id', `部材${n} ID`, 'text')),
          el('td', {}, textInput(p, 'name', `部材${n} 名前`, 'text')),
          ...(is1D
            ? [el('td', {}, textInput(p, 'length', `部材${n} 長さ`))]
            : [el('td', {}, textInput(p, 'width', `部材${n} 幅`)), el('td', {}, textInput(p, 'height', `部材${n} 高さ`))]),
          el('td', {}, qty),
          ...(is1D
            ? []
            : [
                el('td', { class: 'center' }, checkbox(p, 'canRotate', `部材${n} 回転可`)),
                el('td', {}, grainSelect(p, `部材${n} 木目`)),
              ]),
          el('td', {}, removeButton(state.parts, i, `部材${n} を削除`)),
        ];
        return el('tr', {}, cells);
      })
    )
  );
}

function renderForm() {
  for (const radio of document.querySelectorAll('input[name="dimension"]')) {
    radio.checked = radio.value === state.dimension;
  }
  $('kerf').value = state.kerf;
  $('min-length').value = state.minLength;
  $('min-width').value = state.minWidth;
  $('min-height').value = state.minHeight;
  for (const node of document.querySelectorAll('.dim-1d')) node.hidden = state.dimension !== '1D';
  for (const node of document.querySelectorAll('.dim-2d')) node.hidden = state.dimension !== '2D';
  renderStocks();
  renderParts();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toInput(state)));
  } catch {
    // Storage may be unavailable (private mode etc.); the playground works without it
  }
}

function restoreState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      state = fromInput(JSON.parse(saved));
      return true;
    }
  } catch {
    // Ignore broken or unavailable storage
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tabs (form / JSON)

function activeTab() {
  return $('tab-json').getAttribute('aria-selected') === 'true' ? 'json' : 'form';
}

function selectTab(tab) {
  const isJson = tab === 'json';
  $('tab-form').setAttribute('aria-selected', String(!isJson));
  $('tab-json').setAttribute('aria-selected', String(isJson));
  $('pane-form').hidden = isJson;
  $('pane-json').hidden = !isJson;
  if (isJson) $('json-input').value = JSON.stringify(toInput(state), null, 2);
}

function applyJson() {
  try {
    state = fromInput(JSON.parse($('json-input').value));
    renderForm();
    saveState();
    hideError();
    selectTab('form');
  } catch (err) {
    showError(`JSON を読み込めませんでした: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Presets

async function loadPreset(file) {
  const response = await fetch(`examples/${file}`);
  if (!response.ok) throw new Error(`${file} を読み込めませんでした`);
  state = fromInput(await response.json());
  renderForm();
  saveState();
  if (activeTab() === 'json') selectTab('json');
}

// ---------------------------------------------------------------------------
// Running and results

let lastResult = null;
let lastSvg = '';

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}

function hideError() {
  $('error').hidden = true;
}

function currentInput() {
  if (activeTab() === 'json') {
    try {
      return JSON.parse($('json-input').value);
    } catch (err) {
      throw new Error(`JSON の構文エラー: ${err.message}`);
    }
  }
  return toInput(state);
}

function formatNumber(n, digits = 0) {
  return n.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function stat(label, value, warn = false) {
  return el('div', { class: 'stat' }, [el('div', { class: 'label' }, label), el('div', { class: `value${warn ? ' warn' : ''}` }, value)]);
}

function run() {
  hideError();
  let input;
  try {
    input = currentInput();
  } catch (err) {
    showError(err.message);
    return;
  }
  const engineName = $('engine').value;
  const engine = engineName === 'wasm' && engines.wasm ? engines.wasm : engines.ts;
  const engineLabel = engine === engines.wasm ? 'WebAssembly' : 'TypeScript';

  let result;
  let elapsed;
  try {
    const start = performance.now();
    result = engine.optimize(input);
    elapsed = performance.now() - start;
    lastSvg = engine.renderSvg(result, input);
  } catch (err) {
    showError(err.message.replace(/^Invalid input: /, '入力エラー: '));
    return;
  }
  lastResult = result;
  renderResult(result, lastSvg, elapsed, engineLabel, input);
  $('download-svg').disabled = false;
  $('download-json').disabled = false;
  $('print').disabled = false;
}

/** Formats a millimetre value for instructions (up to 1 decimal). */
function mm(n) {
  return formatNumber(Math.round(n * 10) / 10, Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1);
}

/**
 * Builds the printable cut procedure: for each used stock, the parts cut from it and
 * the cuts in order (the `step` of each cut), with positions from the top-left corner.
 */
function renderCutProcedure(result, input) {
  const request = input && typeof input === 'object' && 'input' in input ? input.input : input;
  const names = new Map((request?.parts ?? []).map((p) => [p.id, p.name || p.id]));
  const trims = new Map((request?.stocks ?? []).map((s) => [s.id, Number(s.trim) || 0]));
  const kerf = Number(request?.kerf) || 0;
  const is2D = result.dimension === '2D';

  const blocks = result.stocks.map((stock) => {
    const size = is2D ? `${mm(stock.width)}×${mm(stock.height)} mm` : `${mm(stock.length)} mm`;
    const counts = new Map();
    for (const p of stock.placements) {
      const dims = is2D ? `${mm(p.width)}×${mm(p.height)}` : mm(p.length);
      const key = `${names.get(p.part_id) ?? p.part_id} ${dims}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const partsText = [...counts].map(([key, n]) => `${key} ×${n}`).join('、');

    const steps = [];
    const trim = trims.get(stock.stock_id) ?? 0;
    if (trim > 0) {
      steps.push(is2D ? `四辺を ${mm(trim)} mm ずつ切り落とす` : `両端を ${mm(trim)} mm ずつ切り落とす`);
    }
    for (const c of [...stock.cuts].sort((a, b) => a.step - b.step)) {
      if (!is2D) {
        steps.push(`左端から ${mm(c.x)} mm の位置で切る`);
      } else if (c.type === 'horizontal') {
        steps.push(`横に切る：上端から ${mm(c.y)} mm（左から ${mm(c.x)}〜${mm(c.x + c.length)} mm の範囲）`);
      } else {
        steps.push(`縦に切る：左端から ${mm(c.x)} mm（上から ${mm(c.y)}〜${mm(c.y + c.length)} mm の範囲）`);
      }
    }

    return el('div', { class: 'procedure' }, [
      el('h3', {}, `#${stock.index + 1} ${stock.stock_id}（${size}）`),
      el('p', { class: 'small' }, `切り出す部材：${partsText}`),
      steps.length > 0 ? el('ol', {}, steps.map((s) => el('li', {}, s))) : el('p', { class: 'small muted' }, '切断は不要です'),
    ]);
  });

  return el('div', {}, [
    el(
      'p',
      { class: 'small muted' },
      `位置は原材の左上（1D は左端）からの距離です。刃の厚み（${mm(kerf)} mm）は線の右側・下側に入ります。番号の順に切ると、各カットは板の端から端まで通ります（ギロチンカット）。`
    ),
    ...blocks,
  ]);
}

function renderResult(result, svg, elapsed, engineLabel, input) {
  const s = result.summary;
  const is2D = result.dimension === '2D';
  const unplaced = result.unplaced_parts.reduce((n, u) => n + u.quantity, 0);
  const costs = s.stock_usage.map((u) => u.cost).filter((c) => c !== null);
  const remnant = is2D ? `${formatNumber(s.total_remnant_measure / 1e6, 2)} m²` : `${formatNumber(s.total_remnant_measure)} mm`;

  const stats = el('div', { class: 'stats' }, [
    stat('歩留まり', `${formatNumber(s.yield_rate * 100, 1)}%`),
    stat(is2D ? '使用する板' : '使用する材', `${s.stock_count_used} ${is2D ? '枚' : '本'}`),
    stat('配置した部材', `${s.parts_placed} / ${s.parts_total}`),
    stat('配置できない部材', String(unplaced), unplaced > 0),
    stat('再利用できる端材', remnant),
    ...(costs.length > 0 ? [stat('費用の合計', formatNumber(costs.reduce((a, b) => a + b, 0)))] : []),
    stat('計算時間', `${formatNumber(elapsed, elapsed < 10 ? 1 : 0)} ms`),
  ]);

  const usageTable = el('div', { class: 'table-wrap' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [el('th', {}, '原材'), el('th', {}, '数量'), el('th', {}, '費用')])),
      el(
        'tbody',
        {},
        s.stock_usage.map((u) =>
          el('tr', {}, [
            el('td', {}, u.stock_id),
            el('td', {}, `${u.quantity} ${is2D ? '枚' : '本'}`),
            el('td', {}, u.cost === null ? '—' : formatNumber(u.cost)),
          ])
        )
      ),
    ]),
  ]);

  const children = [
    stats,
    el('div', { class: 'section-label' }, [el('span', {}, '購入リスト'), el('span', { class: 'muted small' }, `計算エンジン: ${engineLabel}`)]),
    usageTable,
  ];

  if (unplaced > 0) {
    children.push(
      el(
        'p',
        { class: 'error' },
        `配置できない部材: ${result.unplaced_parts.map((u) => `${u.part_id} ×${u.quantity}`).join(', ')}（原材が足りないか、原材より大きい部材です）`
      )
    );
  }

  const diagram = el('div', { class: 'diagram', role: 'img', 'aria-label': 'カット図面' });
  diagram.innerHTML = svg; // Generated by the library; all text in it is XML-escaped
  children.push(
    el('div', { class: 'section-label' }, el('span', {}, 'カット図面')),
    el('div', { class: 'legend' }, [
      el('span', { class: 'l-part' }, '部材（↻ は回転）'),
      el('span', { class: 'l-remnant' }, '再利用できる端材'),
      el('span', { class: 'l-waste' }, '廃材・刃厚'),
      el('span', { class: 'l-cut' }, 'カット線（ホバーで切断順）'),
    ]),
    diagram,
    el('div', { class: 'section-label' }, el('span', {}, 'カット手順')),
    renderCutProcedure(result, input),
    el('details', { class: 'no-print' }, [el('summary', {}, '結果 JSON'), el('pre', {}, JSON.stringify(result, null, 2))])
  );

  $('result-body').replaceChildren(...children);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Wiring

function bindTopLevelInputs() {
  for (const radio of document.querySelectorAll('input[name="dimension"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked && radio.value !== state.dimension) {
        state = emptyState(radio.value);
        renderForm();
        saveState();
      }
    });
  }
  const bind = (id, key) =>
    $(id).addEventListener('input', (e) => {
      state[key] = e.target.value;
      saveState();
    });
  bind('kerf', 'kerf');
  bind('min-length', 'minLength');
  bind('min-width', 'minWidth');
  bind('min-height', 'minHeight');

  $('add-stock').addEventListener('click', () => {
    state.stocks.push(newStock(state.dimension, state.stocks.length + 1));
    renderStocks();
    saveState();
  });
  $('add-part').addEventListener('click', () => {
    state.parts.push(newPart(state.parts.length + 1));
    renderParts();
    saveState();
  });

  $('tab-form').addEventListener('click', () => selectTab('form'));
  $('tab-json').addEventListener('click', () => selectTab('json'));
  $('apply-json').addEventListener('click', applyJson);
  $('run').addEventListener('click', run);

  $('download-svg').addEventListener('click', () => lastSvg && download('cut-plan.svg', lastSvg, 'image/svg+xml'));
  $('print').addEventListener('click', () => window.print());
  $('download-json').addEventListener('click', () =>
    lastResult && download('result.json', JSON.stringify(lastResult, null, 2), 'application/json')
  );

  const preset = $('preset');
  preset.append(el('option', { value: '' }, '選択してください'), ...PRESETS.map((p) => el('option', { value: p.file }, p.label)));
  preset.addEventListener('change', async () => {
    if (!preset.value) return;
    try {
      await loadPreset(preset.value);
      run();
    } catch (err) {
      showError(err.message);
    }
  });
}

async function main() {
  bindTopLevelInputs();
  const restored = restoreState();
  if (restored) {
    renderForm();
  } else {
    $('preset').value = PRESETS[0].file;
    try {
      await loadPreset(PRESETS[0].file);
    } catch {
      renderForm();
    }
  }
  try {
    await loadEngines();
  } catch (err) {
    showError(`計算エンジンを読み込めませんでした: ${err.message}`);
    $('run').disabled = true;
    return;
  }
  run();
}

main();
