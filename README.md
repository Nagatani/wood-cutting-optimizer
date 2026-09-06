# Wood Cutting Optimizer (木材カット最適化アルゴリズム)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript: Zero Dependency](https://img.shields.io/badge/TypeScript-Zero--Dependency-brightgreen.svg)
![Python: Zero Dependency](https://img.shields.io/badge/Python-Zero--Dependency-brightgreen.svg)

**Wood Cutting Optimizer** は、DIY・木工作業現場・家具製作に特化した、**完全外部依存ゼロ（Zero-dependency）** の木材カットパターン最適化エンジンです。

1次元の棒材（角材・ツーバイフォー材等）および2次元の板材（合板・サブロク板等）の歩留まり最適化を行い、鋸刃の厚み（Kerf）、ギロチンカット制約、木目方向（Grain）、再利用可能端材（Remnants）の識別に対応しています。

TypeScript 実装と Python 実装を同等の最適化アルゴリズム・同一の JSON 入出力仕様で提供しています。

---

## 主な特徴と木工特有の必須制約

一般的な 2D ビンパッキング問題と異なり、実際の木工作業現場で物理的に切断可能なカットプランを算出します。

| 機能 / 制約 | 説明 |
| :--- | :--- |
| **鋸刃の厚み (Saw Kerf)** | 丸ノコやパネルソーの刃厚（例: 2.0mm 〜 3.5mm）を厳密に考慮。カットごとに失われる寸法を計算し、寸法不足や部材重複を防止します。 |
| **ギロチンカット制約 (Guillotine Cuts)** | 板の端から端まで突き抜ける一刀両断カット（Guillotine Cut）を厳密に保証。切断順序（Step）と切断線分座標を出力し、実際のカット作業手順書やSVG描画に直結します。 |
| **木目方向 (Grain Direction)** | 部材ごとに「木目沿い（回転禁止）」または「回転許可」を指定可能。原板の木目方向（縦・横）と部材の木目方向を自動判定します。 |
| **端材 (Remnants) の判定** | 最小再利用可能サイズ（`min_remnant_size`）以上の余白を「再利用可能な端材（Remnant）」としてマークし、ゴミ（Waste/おがくず）と明確に区別します。 |
| **Zero-dependency** | ランタイム外部パッケージへの依存は一切ありません。TypeScript は Node.js 標準のみ、Python は標準ライブラリ（3.9+）のみで動作します。 |

---

## ディレクトリ構成

```text
wood-cutting-optimizer/
├── LICENSE                 # MIT License
├── README.md               # 本ドキュメント
├── specification/
│   └── schema.json         # 入出力標準 JSON Schema
├── test-cases/             # 言語共通の検証シナリオ (1D, 2D, 木目制約)
│   ├── 1d_basic.json
│   ├── 2d_guillotine.json
│   └── 2d_grain_rotation.json
└── packages/
    ├── typescript/         # Zero-dependency TypeScript コア
    │   ├── src/            # 1D/2D 最適化アルゴリズム
    │   ├── bin/cli.ts      # CLI ツール
    │   └── tests/          # test-cases を用いた node:test 自動検証
    └── python/             # Zero-dependency Python コア
        ├── wood_cutting_optimizer/ # 1D/2D 最適化アルゴリズム & CLI
        └── tests/          # test-cases を用いた unittest 自動検証
```

---

## クイックスタート (TypeScript)

### 1. インストール / ビルド

```bash
cd packages/typescript
npm install
npm run build
```

### 2. CLI からの実行

```bash
# JSON ファイルを入力して最適化（標準出力に出力）
node dist/bin/cli.js --input ../../test-cases/2d_guillotine.json

# 出力ファイル名を指定
node dist/bin/cli.js -i input.json -o result.json
```

### 3. コードからの利用 (TypeScript / JavaScript)

```typescript
import { optimize, InputRequest } from 'wood-cutting-optimizer';

const request: InputRequest = {
  dimension: '2D',
  kerf: 3.0,
  min_remnant_size: { width: 150, height: 150 },
  stocks: [
    { id: 'sheet-1', width: 910, height: 1820, quantity: 1, grain: 'length' }
  ],
  parts: [
    { id: 'side', name: '側板', width: 900, height: 300, quantity: 2, can_rotate: true },
    { id: 'shelf', name: '棚板', width: 500, height: 300, quantity: 5, can_rotate: true }
  ]
};

const result = optimize(request);

console.log(`歩留まり: ${(result.summary.yield_rate * 100).toFixed(1)}%`);
console.log(`使用板数: ${result.summary.stock_count_used} 枚`);
```

---

## クイックスタート (Python)

### 1. セットアップ

Python 3.9 以上に対応。外部パッケージのインストールは不要です。

```bash
cd packages/python
pip install -e .
```

### 2. CLI からの実行

```bash
# モジュールから直接実行
python -m wood_cutting_optimizer ../../test-cases/2d_guillotine.json

# またはインストール後のコマンド (wood-opt でも実行可能)
wood-cutting-optimizer -i input.json -o result.json
```

### 3. コードからの利用 (Python)

```python
from wood_cutting_optimizer import optimize

data = {
    "dimension": "2D",
    "kerf": 3.0,
    "min_remnant_size": {"width": 150.0, "height": 150.0},
    "stocks": [
        {"id": "sheet-1", "width": 910.0, "height": 1820.0, "quantity": 1, "grain": "length"}
    ],
    "parts": [
        {"id": "side", "name": "側板", "width": 900.0, "height": 300.0, "quantity": 2, "can_rotate": True},
        {"id": "shelf", "name": "棚板", "width": 500.0, "height": 300.0, "quantity": 5, "can_rotate": True}
    ]
}

result = optimize(data)

print(f"歩留まり: {result.summary.yield_rate * 100:.1f}%")
print(f"使用板数: {result.summary.stock_count_used} 枚")
print(f"ギロチンカット数: {len(result.stocks[0].cuts)} 回")
```

---

## 汎用 1次元ビンパッキング (Generic 1D Bin Packing)

木材カット固有の制約（鋸刃厚 kerf、端材分類、切断順序など）を必要としない、**汎用的な 1D ビンパッキング計算ロジック**も独立したインターフェイスとして提供しています。

ディスク容量配分、荷物梱包、タスク割り当て、予算配分など、任意の一次元容量詰め込み問題にそのままご利用いただけます。

### 主な特徴
- **木材制約フリー**: 刃厚・切断ステップ・端材分類なしでシンプルに利用可能
- **アイテム間隔 (Spacing)**: 必要に応じてアイテム間の最小間隙（パディングやマージン）をオプション指定可能
- **複数戦略の選択**: `best-fit-decreasing` (デフォルト), `first-fit-decreasing`, `worst-fit-decreasing`
- **メタデータの透過保持**: Bin および Item に呼び出し元の独自オブジェクト（ジェネリクス `data`）を付与可能

### TypeScript での利用例

```typescript
import { binPack1D, BinDefinition, ItemDefinition } from 'wood-cutting-optimizer';

const bins: BinDefinition[] = [
  { id: 'server-1', capacity: 100, quantity: 2 },
  { id: 'server-2', capacity: 150, quantity: 1 }
];

const items: ItemDefinition[] = [
  { id: 'job-A', size: 60 },
  { id: 'job-B', size: 40 },
  { id: 'job-C', size: 70 },
  { id: 'job-D', size: 30 }
];

const result = binPack1D(bins, items, {
  strategy: 'best-fit-decreasing'
});

console.log(`使用ビン数: ${result.summary.binsUsed}`);
console.log(`平均充填率: ${(result.summary.averageUtilization * 100).toFixed(1)}%`);
```

### Python での利用例

```python
from wood_cutting_optimizer.binpacking import bin_pack_1d, BinDefinition, ItemDefinition

bins = [
    BinDefinition(id="container-1", capacity=100.0, quantity=2),
    BinDefinition(id="container-2", capacity=150.0, quantity=1),
]

items = [
    ItemDefinition(id="pkg-1", size=60.0),
    ItemDefinition(id="pkg-2", size=40.0),
    ItemDefinition(id="pkg-3", size=70.0),
    ItemDefinition(id="pkg-4", size=30.0),
]

result = bin_pack_1d(bins, items)

print(f"使用ビン数: {result.summary.bins_used}")
print(f"平均充填率: {result.summary.average_utilization * 100:.1f}%")
```


---

## テスト実行 (言語共通シナリオ)

両言語ともに `test-cases/*.json` を入力として同一の検証シナリオを実行します。

### TypeScript テスト (Node.js 組み込み `node:test`)
```bash
cd packages/typescript
npm test
```

### Python テスト (標準 `unittest`)
```bash
cd packages/python
python -m unittest discover -s tests
```

---

## 入出力データ仕様 (Summary)

完全な仕様は [specification/schema.json](specification/schema.json) を参照してください。

### 出力フォーマットの要点
- `summary`:
  - `yield_rate`: 歩留まり（0.0 〜 1.0）
  - `stock_count_used`: 使用した原材数
  - `total_used_measure`: 部材が占める純面積/純長さ
  - `total_remnant_measure`: 再利用可能な端材の合計
  - `total_waste_measure`: 刃厚による切損および規定サイズ未満の廃棄余白
- `stocks`:
  - `placements`: 各部材の座標 `(x, y)`、配置寸法 `(width, height)`、回転有無 `rotated`
  - `cuts`: ギロチンカット情報 `(type: "horizontal" | "vertical", x, y, length, kerf, step)`
  - `remnants`: 再利用可能な端材矩形リスト
  - `waste`: 廃棄余白矩形リスト
- `unplaced_parts`: 在庫不足等で収容しきれなかった部材のリスト

---

## ロードマップ

- [x] Zero-dependency TypeScript 実装 (1D / 2D Guillotine)
- [x] Zero-dependency Python 実装 (1D / 2D Guillotine)
- [x] 汎用 1D ビンパッキング計算ロジック＆インターフェイス (TypeScript / Python)
- [x] 言語共通 JSON Schema & テストケース駆動検証
- [ ] SVG カット図面出力レンダラー（プレビュー機能）

- [ ] Rust コアエンジンへの移植 & WebAssembly (wasm-bindgen) / PyO3 バインディング
- [ ] コスト最適化（複数サイズのストックが存在する場合の最小コスト探索）

---

## ライセンス

[MIT License](LICENSE)
