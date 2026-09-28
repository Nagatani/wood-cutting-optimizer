# AGENTS.md

このファイルは、本リポジトリで作業する AI コーディングエージェント向けのガイドです。
ユーザー向けの説明は [README.md](README.md) を参照してください。

## プロジェクト概要

**wood-cutting-optimizer** は、木材カットパターンの最適化エンジンです。

- 1D（棒材・角材）と 2D（合板などの板材）の歩留まり最適化
- 木工特有の制約: 鋸刃厚（kerf）、ギロチンカット、木目方向（grain）、再利用可能端材（remnant）
- 木材制約を持たない汎用 1D ビンパッキング API（`binPack1D` / `bin_pack_1d`）
- **TypeScript 実装と Python 実装を並行して提供**し、同じアルゴリズム・同じ JSON 入出力仕様を持つ
- **ランタイム依存ゼロ（Zero-dependency）** が設計上の必須要件

## リポジトリ構成

```text
specification/schema.json      # 入出力の JSON Schema（言語共通の正）
test-cases/*.json              # 言語共通の検証シナリオ（{ name, description, input, expected }）
packages/typescript/
  src/index.ts                 # optimize() エントリポイント（dimension で 1D/2D に振り分け）
  src/types.ts                 # 入出力型（schema.json に準拠、snake_case）
  src/optimizer1d.ts           # 1D 最適化（内部で binPack1D を利用）
  src/optimizer2d.ts           # 2D ギロチン最適化
  src/binpacking/              # 汎用 1D ビンパッキング（types.ts, packer1d.ts）
  bin/cli.ts                   # CLI（wood-cutting-optimizer / wood-opt）
  tests/*.test.ts              # node:test
packages/python/
  wood_cutting_optimizer/
    __init__.py                # optimize() エントリポイント（dict を受け取り dataclass に変換）
    types.py                   # 入出力 dataclass（OptimizationResult.to_dict()）
    optimizer1d.py / optimizer2d.py
    binpacking/                # 汎用 1D ビンパッキング（types.py, packer1d.py）
    cli.py / __main__.py       # CLI（argparse）
  tests/test_*.py              # unittest
```

TS と Python のファイルは 1 対 1 で対応しています（`optimizer2d.ts` ↔ `optimizer2d.py` など）。

## セットアップ・ビルド・テスト

### TypeScript（`packages/typescript`）

```bash
cd packages/typescript
npm install
npm run build     # tsc → dist/ に出力
npm test          # node --test dist/tests/*.test.js
```

- テストは **ビルド後の `dist/` に対して実行** されます。ソースを変更したら必ず `npm run build` してから `npm test` してください。
- ESM（`"type": "module"`、`module: NodeNext`）のため、相対 import には **`.js` 拡張子が必須** です（例: `from './types.js'`）。
- `strict: true` です。

### Python（`packages/python`）

```bash
cd packages/python
python -m unittest discover -s tests
python -m wood_cutting_optimizer ../../test-cases/2d_guillotine.json   # CLI 動作確認
```

- Python 3.9 以上をサポート。3.10+ 専用構文（`match`、`X | Y` 型表記の実行時評価など）は使わないでください。各モジュールは `from __future__ import annotations` を使用しています。
- テストフレームワークは標準の `unittest` のみ（pytest 前提のコードは書かない）。

## 必須ルール

1. **依存を追加しない**: ランタイム依存は TS・Python とも禁止。TS は Node.js 標準モジュール、Python は標準ライブラリのみ。TS の devDependencies も `typescript` と `@types/node` のみを維持してください。
2. **両言語の同期**: アルゴリズム・仕様・公開 API の変更は、原則として TypeScript と Python の **両方に同じ内容で** 反映してください。片方だけの変更は結果の不一致を生みます。
3. **仕様の単一の正は `specification/schema.json`**: 入出力フィールドを追加・変更する場合は、schema.json → `src/types.ts` → `types.py` → README の「入出力データ仕様」の順で整合させてください。
4. **言語共通テストケース**: 新しい振る舞いを追加したら `test-cases/` に JSON シナリオを追加し、TS（`tests/run_cases.test.ts`）と Python（`tests/test_cases.py`）の両方から検証してください。

## 命名規則

- 木材カット API（`optimize` の入出力）: JSON 仕様に合わせて **両言語とも snake_case**（`min_remnant_size`, `can_rotate`, `yield_rate`, `unplaced_parts` など）。
- 汎用ビンパッキング API: **TS は camelCase**（`binPack1D`, `itemSpacing`, `binsUsed`）、**Python は snake_case**（`bin_pack_1d`, `item_spacing`, `bins_used`）。各言語の慣習に合わせています。
- 関数名: TS `optimize1D` / `optimize2D` ↔ Python `optimize_1d` / `optimize_2d`。

## アルゴリズムの要点

### 1D（`optimizer1d`）
- `binPack1D` / `bin_pack_1d` を `strategy: best-fit-decreasing`、`itemSpacing = kerf` で呼び出すラッパー。
- 部材間にのみ kerf を入れる（先頭部材の前には入れない）。`cuts[].x` は `次の部材の offset - kerf`。
- 末尾の余りが `min_remnant_size.length` 以上なら remnant、未満なら waste。切断ロス（`cuts.length * kerf`）も waste に加算。

### 汎用 1D ビンパッキング（`binpacking/packer1d`）
- `quantity` 分だけアイテムを展開 → サイズ降順ソート → BFD / FFD / WFD で既存ビンへ配置。
- 既存ビンに入らない場合、在庫プールから「アイテム配置後の余りが最小」の種類のビンを新規オープン。
- 収まらないアイテムは `unpackedItems` に id 単位で集計。
- `data`（ジェネリクス）で呼び出し側のメタデータを透過的に保持。

### 2D（`optimizer2d`）
- 部材を `quantity` 分展開し、面積降順（同面積なら長辺降順）でソート。
- 既存の使用中シート全体から **Best Short Side Fit (BSSF)** で最良の空き矩形を選択。
- どこにも入らなければ、配置可能な在庫のうち **面積最小** のシートを新規オープン。
- 配置後は **Shorter Leftover Axis Split (SLAS)** でギロチン分割し、kerf を差し引いた空き矩形を生成。`cuts` には `step` 番号付きで切断線を記録。
- 木目判定 `isOrientationAllowed` / `is_orientation_allowed`:
  - `can_rotate: false` なら回転不可。
  - シートか部材のどちらかが `grain: "none"` なら向きは自由。
  - 両方に木目があれば、同じ向きなら非回転のみ、異なれば 90° 回転のみ許可。
  - `can_rotate` のデフォルトは `true`、`grain` のデフォルトは `"none"`。
- 最終的に残った空き矩形のうち、`min_remnant_size` の width/height を両方満たすものは remnant、それ以外は waste。切断ロス（`kerf * cut.length`）も waste に加算。

### 数値の丸め
- サマリーの比率・合計は `toFixed(4)` / `round(…, 4)` 相当で丸めています（ビンパッキングの容量系は 6 桁）。
- テストでの座標比較は `1e-6` の許容誤差を使っています。浮動小数点の厳密一致に依存するテストは避けてください。

## 既知の差異・注意点

- Python の `optimize()` は `{ "input": {...} }` 形式のラッパーを受け付けますが、TS の `optimize()` は受け付けません（TS では CLI 側でアンラップしています）。
- 2D のサマリーで、TS は `total_stock_measure` / `total_used_measure` を丸めていませんが、Python は `round(…, 4)` しています（他の項目は両言語で丸め済み）。
- `cost` フィールドは入力として受け付けますが、現状の在庫選択ロジックでは使われていません（ロードマップ「コスト最適化」参照）。
- ロードマップ上の未実装項目: SVG カット図面レンダラー、Rust/WASM/PyO3 移植、コスト最適化。

## コミット

- コミットメッセージは Conventional Commits 風のプレフィックス（`feat:`, `fix:` など）＋日本語の説明が慣例です。
- `dist/`, `node_modules/`, `__pycache__/`, `*.egg-info/` はコミットしないでください（`.gitignore` 済み）。
