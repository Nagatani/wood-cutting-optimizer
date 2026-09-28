# wood-cutting-optimizer (Rust / WebAssembly)

Zero-dependency な 1D / 2D 木材カット最適化ライブラリの Rust 実装です。WebAssembly（wasm-bindgen）にもビルドでき、ブラウザや Node.js から使えます。

TypeScript 版・Python 版と同じ JSON 入出力（`specification/schema.json`）・同じアルゴリズムで、**同じ入力に対してバイト単位で同一の JSON と SVG** を出力します（CI の `scripts/check_parity.py` で検証）。処理速度は TypeScript 版の約 8〜10 倍です。

## ライブラリとして使う

```rust
use wood_cutting_optimizer::{json, optimize, render_svg};

let input = json::parse(r#"{
    "dimension": "2D",
    "kerf": 3,
    "stocks": [{ "id": "saburoku", "width": 910, "height": 1820, "quantity": "unlimited" }],
    "parts": [{ "id": "shelf", "name": "棚板", "width": 600, "height": 300, "quantity": 4 }]
}"#)?;

let result = optimize(&input)?;                     // Err("Invalid input: ...") for invalid input
println!("{}", result.summary.yield_rate);
println!("{}", result.to_value().to_pretty_string()); // same JSON as the TypeScript CLI
let svg = render_svg(&result, Some(&input));          // SVG cutting diagram
```

型付きの入力（`InputRequest`）を渡す `optimize_request`、JSON 文字列をそのまま扱う `optimize_json`、汎用 1D ビンパッキングの `bin_pack_1d` もあります。

## CLI

```bash
cargo build --release
./target/release/wood-cutting-optimizer -i input.json -o result.json --svg cut-plan.svg
```

オプションと終了コード（正常 0、入力エラー 1、引数エラー 2）は TypeScript 版・Python 版と同じです。

## WebAssembly

```bash
rustup target add wasm32-unknown-unknown

# wasm-pack を使う場合
wasm-pack build --release --target web -- --features wasm        # ブラウザ（ES modules）
wasm-pack build --release --target nodejs -- --features wasm     # Node.js

# wasm-bindgen CLI を直接使う場合（CLI のバージョンは Cargo.lock の wasm-bindgen と一致させる）
cargo build --release --lib --target wasm32-unknown-unknown --features wasm
wasm-bindgen target/wasm32-unknown-unknown/release/wood_cutting_optimizer.wasm --out-dir pkg --target web
```

```javascript
import init, { optimize, renderSvg } from './pkg/wood_cutting_optimizer.js';

await init();
const input = { dimension: '1D', kerf: 3, stocks: [{ id: 's', length: 1820, quantity: 'unlimited' }], parts: [{ id: 'leg', length: 800, quantity: 4 }] };
const result = optimize(input);          // result object (throws on invalid input)
const svg = renderSvg(result, input);    // SVG cutting diagram
```

`optimizeJson(jsonString)` は結果を整形済み JSON 文字列で返します。

入出力仕様・アルゴリズムの詳細はリポジトリの [README](https://github.com/Nagatani/wood-cutting-optimizer#readme) を参照してください。
