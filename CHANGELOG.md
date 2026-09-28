# Changelog

このプロジェクトの主な変更点です。TypeScript 版・Python 版は同じバージョン番号で、同じ機能・同じ入出力仕様を持ちます。

## 0.2.0

### 追加
- **コスト・歩留まり最適化**: 複数のヒューリスティクス（2D は最大144通り、1D は9通り）を試し、未配置が最少 → 総コスト最小 → 使用数最少 → 端材最大 → カット数最少 の解を選択。原材の `cost` を考慮（未指定時は面積／長さ）。1D は、より安い原材へのダウンサイジングも実施
- **数量無制限の原材**: `stocks[].quantity` に `"unlimited"` を指定可能（購入計画用）
- **端の切り落とし**: `stocks[].trim` で、2D は四辺・1D は両端から指定幅を落としてから配置
- **購入リスト**: 出力 `summary.stock_usage`（原材ごとの使用数と費用）
- **SVG カット図面**: `renderSvg` / `render_svg`、CLI の `--svg` オプション
- **汎用 1D ビンパッキング**: 新規ビンの選び方 `binSelection` / `bin_selection`（`smallest` / `largest` / `lowest-cost-ratio`）
- **入力検証**: `specification/schema.json` に基づき、不正な入力を `Invalid input: ...` のエラーにする（TS: `Error`、Python: `ValueError`）
- CI（GitHub Actions）、TS と Python の出力一致検証（`scripts/check_parity.py`）、schema 準拠の検証（`scripts/validate_schema.py`）

### 変更（出力が変わるもの）
- 1D: 最後の部材の後にも最終カットを出力し、余りから刃厚を差し引くようにした（端材の長さが刃厚ぶん短くなる）
- 同じ入力でも、原材の選び方・配置が 0.1.0 と異なる場合がある（より良い解を選ぶため）
- 木目なし（`grain: "none"`）の原板では、端材を縦横どちらの向きでも判定する
- TS 版 `optimize()` が `{ "input": {...} }` 形式も受け付けるようにした（Python 版と統一）
- 2D サマリーの `total_stock_measure` / `total_used_measure` を TS 版でも小数4桁に丸める（Python 版と統一）

### 修正
- 2D: 余りが刃厚より薄い場合に切断ロスを過大に計上し、収支が合わなかった問題
- 浮動小数点誤差で、ちょうど収まる部材が配置されなかった問題（許容誤差 `1e-9` を導入）
- 負の寸法や未知の strategy などの不正な入力が、黙って処理されていた問題
- `stocks` / `parts` 内の `id` の重複や空配列を受け付けていた問題
- TS 版 CLI が未知のオプションや値の抜けを無視していた問題（Python 版と同じ終了コード 2 に統一）
- 全部材が未配置のとき SVG が極小になる問題

### パッケージ
- npm パッケージからテストコード（`dist/tests`）を除外

## 0.1.0

- 初版: 1D / 2D ギロチンカット最適化（刃厚・木目・端材）、汎用 1D ビンパッキング、TS / Python 実装、JSON Schema、CLI
