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
.github/workflows/ci.yml       # CI（TS テスト / Python テスト / 言語間パリティ検証）
scripts/check_parity.py        # test-cases/ に対して TS と Python の出力が一致するか検証
specification/schema.json      # 入出力の JSON Schema（言語共通の正）
test-cases/*.json              # 言語共通の検証シナリオ（{ name, description, input, expected }）
packages/typescript/
  src/index.ts                 # optimize() エントリポイント（dimension で 1D/2D に振り分け）
  src/types.ts                 # 入出力型（schema.json に準拠、snake_case）
  src/optimizer1d.ts           # 1D 最適化（内部で binPack1D を利用）
  src/optimizer2d.ts           # 2D ギロチン最適化
  src/validate.ts              # 入力検証（schema.json の制約をチェック）
  src/binpacking/              # 汎用 1D ビンパッキング（types.ts, packer1d.ts）
  bin/cli.ts                   # CLI（wood-cutting-optimizer / wood-opt）
  tests/*.test.ts              # node:test
packages/python/
  wood_cutting_optimizer/
    __init__.py                # optimize() エントリポイント（dict を受け取り dataclass に変換）
    types.py                   # 入出力 dataclass（OptimizationResult.to_dict()）
    optimizer1d.py / optimizer2d.py
    validate.py                # 入力検証（schema.json の制約をチェック）
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
npm test          # pretest で dist/ を削除・再ビルドしてから node --test dist/tests/*.test.js
```

- テストはビルド後の `dist/` に対して実行されますが、`npm test` の `pretest` で毎回 `clean` → `build` されるため、古いビルド成果物でテストが走ることはありません。
- ESM（`"type": "module"`、`module: NodeNext`）のため、相対 import には **`.js` 拡張子が必須** です（例: `from './types.js'`）。
- `strict: true` です。
- npm パッケージに含まれるのは `dist/src` と `dist/bin` のみです（`package.json` の `files`）。

### Python（`packages/python`）

```bash
cd packages/python
python -m unittest discover -s tests
python -m wood_cutting_optimizer ../../test-cases/2d_guillotine.json   # CLI 動作確認
```

- Python 3.9 以上をサポート。3.10+ 専用構文（`match`、`X | Y` 型表記の実行時評価など）は使わないでください。各モジュールは `from __future__ import annotations` を使用しています。
- テストフレームワークは標準の `unittest` のみ（pytest 前提のコードは書かない）。

### 言語間パリティ検証（リポジトリルート）

```bash
(cd packages/typescript && npm run build)
python scripts/check_parity.py   # test-cases/*.json について TS と Python の出力 JSON を比較
```

CI（`.github/workflows/ci.yml`）では Node 20/22、Python 3.9/3.13 のテストとこのパリティ検証を実行します。

## 必須ルール

1. **依存を追加しない**: ランタイム依存は TS・Python とも禁止。TS は Node.js 標準モジュール、Python は標準ライブラリのみ。TS の devDependencies も `typescript` と `@types/node` のみを維持してください。
2. **両言語の同期**: アルゴリズム・仕様・公開 API の変更は、原則として TypeScript と Python の **両方に同じ内容で** 反映してください。片方だけの変更は結果の不一致を生みます。
3. **仕様の単一の正は `specification/schema.json`**: 入出力フィールドを追加・変更する場合は、schema.json → `src/types.ts` → `types.py` → README の「入出力データ仕様」の順で整合させてください。
4. **言語共通テストケース**: 新しい振る舞いを追加したら `test-cases/` に JSON シナリオを追加し、TS（`tests/run_cases.test.ts`）と Python（`tests/test_cases.py`）の両方から検証してください。`test-cases/` の全ファイルは収支の不変条件テスト（`robustness` テスト）とパリティ検証の対象にもなります。
5. **収支の不変条件**: `total_used_measure + total_waste_measure + total_remnant_measure == total_stock_measure` が常に成り立つようにしてください。

## 命名規則

- 木材カット API（`optimize` の入出力）: JSON 仕様に合わせて **両言語とも snake_case**（`min_remnant_size`, `can_rotate`, `yield_rate`, `unplaced_parts` など）。
- 汎用ビンパッキング API: **TS は camelCase**（`binPack1D`, `itemSpacing`, `binsUsed`）、**Python は snake_case**（`bin_pack_1d`, `item_spacing`, `bins_used`）。各言語の慣習に合わせています。
- 関数名: TS `optimize1D` / `optimize2D` ↔ Python `optimize_1d` / `optimize_2d`。

## アルゴリズムの要点

### 1D（`optimizer1d`）
- `binPack1D` / `bin_pack_1d` を `strategy: best-fit-decreasing`、`itemSpacing = kerf` で呼び出すラッパー。
- 部材間にのみ kerf を入れる（先頭部材の前には入れない）。部材間の `cuts[].x` は `次の部材の offset - kerf`。
- 末尾に余りがある場合は、最後の部材の直後（`x = usedCapacity`）に最終カットを追加し、余りから kerf を差し引く。余りが kerf 未満なら余り全体が切断ロスになる。
- kerf を差し引いた余りが `min_remnant_size.length` 以上なら remnant、未満なら waste。切断ロスも waste に加算。

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
- 最終的に残った空き矩形のうち、`min_remnant_size` の width/height を両方満たすものは remnant、それ以外は waste。
- 切断ロスは実際に刃が削った面積（`min(kerf, 残り幅) * cut.length`）を `cutLossArea` / `cut_loss_area` に積算して waste に加算。余りが kerf より薄いと `kerf * length` より小さくなる。

### 入力検証・浮動小数点
- `optimize1D` / `optimize2D`（Python は `optimize_1d` / `optimize_2d`）の先頭で `validateInput` / `validate_1d`・`validate_2d` を呼び、schema.json 違反（負の寸法、非整数の quantity、未知の grain、負の kerf など）は `Invalid input: ...` のエラー（TS: `Error`、Python: `ValueError`）を投げる。
- `binPack1D` / `bin_pack_1d` も不正な容量・サイズ・quantity・`itemSpacing`・未知の strategy をエラーにする。ビンの quantity は `Infinity`（Python は `math.inf`）で無制限。
- 寸法の比較には `EPS = 1e-9` の許容誤差を使う（`0.1 + 0.2` の部材が長さ `0.3` の原材に収まるように）。新しい比較を追加するときも同じ `EPS` を使ってください。

### 数値の丸め
- サマリーの比率・合計は `toFixed(4)` / `round(…, 4)` 相当で丸めています（ビンパッキングの容量系は 6 桁）。
- テストでの座標比較は `1e-6` の許容誤差を使っています。浮動小数点の厳密一致に依存するテストは避けてください。

## 既知の差異・注意点

- `optimize()` は両言語とも `{ "input": {...} }` 形式（テストケースの形）もそのまま受け付けます。
- `cost` フィールドは入力として受け付けますが、現状の在庫選択ロジックでは使われていません（ロードマップ「コスト最適化」参照）。
- ロードマップ上の未実装項目: SVG カット図面レンダラー、Rust/WASM/PyO3 移植、コスト最適化。

## コミット

- コミットメッセージは Conventional Commits 風のプレフィックス（`feat:`, `fix:` など）＋日本語の説明が慣例です。
- `dist/`, `node_modules/`, `__pycache__/`, `*.egg-info/` はコミットしないでください（`.gitignore` 済み）。
