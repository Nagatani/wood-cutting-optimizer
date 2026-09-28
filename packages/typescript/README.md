# wood-cutting-optimizer (TypeScript)

Zero-dependency な 1D / 2D 木材カット最適化ライブラリの TypeScript 実装です（Node.js 20+、ランタイム依存なし）。

```typescript
import { optimize, renderSvg } from 'wood-cutting-optimizer';

const input = {
  dimension: '2D',
  kerf: 3,
  stocks: [{ id: 'saburoku', width: 910, height: 1820, quantity: 'unlimited', cost: 2500 }],
  parts: [{ id: 'shelf', name: '棚板', width: 600, height: 300, quantity: 4 }],
} as const;

const result = optimize(input);
console.log(result.summary.yield_rate, result.summary.stock_usage);
const svg = renderSvg(result, input); // SVG カット図面
```

CLI:

```bash
wood-cutting-optimizer -i input.json -o result.json --svg cut-plan.svg
```

入出力仕様・アルゴリズムの詳細はリポジトリの [README](https://github.com/Nagatani/wood-cutting-optimizer#readme) と `specification/schema.json` を参照してください。
