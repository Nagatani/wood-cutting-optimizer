# wood-cutting-optimizer (Python)

Zero-dependency な 1D / 2D 木材カット最適化ライブラリの Python 実装です（Python 3.9+、標準ライブラリのみ）。

```python
from wood_cutting_optimizer import optimize

result = optimize({
    "dimension": "1D",
    "kerf": 3.0,
    "stocks": [{"id": "stock-2m", "length": 2000.0, "quantity": 3}],
    "parts": [{"id": "leg", "length": 800.0, "quantity": 3}],
})
print(result.summary.yield_rate)
```

CLI:

```bash
wood-cutting-optimizer -i input.json -o result.json
```

入出力仕様・アルゴリズムの詳細はリポジトリの [README](https://github.com/Nagatani/wood-cutting-optimizer#readme) と `specification/schema.json` を参照してください。
