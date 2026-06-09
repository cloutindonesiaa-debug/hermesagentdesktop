# China Market Keyword Research — Techniques

## Problem: Google Suggest gl=CN Blocks Non-ASCII

**Root cause:** Google CN (`google.com.hk` / `gl=CN`) censors international API calls. Any request with Chinese characters (UTF-8 bytes >127) returns `HTTP 400 Bad Request`.

**Affected query pattern:**
```bash
# ❌ FAILS — Chinese characters trigger 400
curl -s "https://suggestqueries.google.com/complete/search?client=firefox&q=巴淡岛仓库出租&gl=CN&hl=zh-CN"
```

## Workarounds

### 1. English proxy queries (recommended for real Suggest data)
Use English queries that Chinese speakers would naturally include when searching about the target market. Chinese buyers searching for "Batam warehouse" often use:
- "batam warehouse singapore"
- "indonesia warehouse near singapore"
- "batam industrial zone"

```bash
# ✅ WORKS — returns Chinese-relevant suggestions in EN
curl -s "https://suggestqueries.google.com/complete/search?client=firefox&q=batam+warehouse+singapore&gl=CN&hl=en" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('\n'.join(d[1]))"

# ✅ WORKS — Bahasa (works from CN geo for non-CJK queries)
curl -s "https://suggestqueries.google.com/complete/search?client=firefox&q=gudang+batam+singapore&gl=CN&hl=id" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('\n'.join(d[1]))"
```

### 2. Strategic reasoning from industry knowledge
When proxy queries don't yield Mandarin-specific terms, derive keywords from:
- Industry terminology for industrial real estate in Mandarin
- Common investment destination names (巴淡岛 / Batam)
- Property type terms (仓库=warehouse, 厂房=factory, 工业园=industrial park)
- Transaction verbs (出租=for rent, 租赁=lease, 投资=investment)

**Validated Mandarin keyword patterns:**
| EN | Mandarin | Notes |
|-----|----------|-------|
| warehouse for rent batam | 巴淡岛仓库出租 | Zero competition observed |
| factory for rent batam | 巴淡岛厂房租赁 | Manufacturing buyers |
| industrial park batam | 巴淡岛工业园 | Zone/infrastructure focus |
| bonded warehouse | 保税仓库 | Trade zone specific |
| free trade zone | 自由贸易区 | KEK incentive mentions |
| logistics center | 物流中心 | Supply chain buyers |
| near singapore | 新加坡附近 | Proximity angle |
| batam free zone | 巴淡岛自由港区 | Brand-name zone |

### 3. Baidu Index (alternative, requires browser)
If Mandarin keyword volume is critical: use `browser_navigate` to Baidu Index (`index.baidu.com`). Browser can handle Chinese characters natively. Requires manual login credentials.

## Session Findings (June 2026 — candibentar.com)

- gl=CN with Chinese characters: **400 Bad Request** confirmed
- gl=CN with English queries: **200 OK**, returns EN suggestions
- Mandarin keyword competition: **practically zero** on all tested terms
- First-mover advantage: HIGH — no dedicated zh-CN pages on candibentar.com and minimal zh-CN content across competing Batam industrial real estate sites
