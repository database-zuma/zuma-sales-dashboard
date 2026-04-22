# Zuma Sales Analytics — Agent Context

Standalone sales dashboard (spawned from `stock-inventory-dashboard`). Only sales, no inventory.

## Architecture

```
Browser (GitHub Pages)
  └─ index.html (single-file HTML+CSS+JS, Chart.js via CDN)
       └─ fetchAPI() → https://srv1346756.hstgr.cloud (VPS)
            └─ nginx → gunicorn → FastAPI → PostgreSQL (openclaw_ops)
```

Shared backend with `stock-inventory-dashboard`. Same `API_BASE`, same `API_KEY`, same endpoints.

## Key constants (index.html)

- `API_BASE` = `https://srv1346756.hstgr.cloud`
- `API_KEY` = `97d25067-a2ca-44ba-ac5b-61539b627271`
- Deploy: `https://database-zuma.github.io/zuma-sales-dashboard/`

## API endpoints used

- `/api/sales/detail?channel={retail|online|wholesale}&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `/api/sales/consignment?from=&to=`
- (future) `/api/sales/refunds`, `/api/targets`

## State & rendering flow

```
state.channel changes → loadChannel(channel, from, to) → cache[channel]
  → populateFilters(rows)
  → applyFilters(rows) → renderExecutive(filtered)
```

## Design language

- iseller-dashboard.vercel.app style (compact, rounded-sm, shadow-sm)
- Palette: `#00E273` (accent), `#002A3A` (navy)
- 6 KPI pattern per tab: Omzet / Pairs / Trx / UPT / ASP / ATV
- Tables: text-xs headers 9px uppercase, tabular-nums for numbers
- Top tabs with green underline, NOT sidebar

## Unified structure across channels

All 9 tabs render for every channel. Non-applicable tabs show empty state.
Label "Toko" swaps to Marketplace/Partner/Customer based on `entityLabel(channel)`.

## Promo tab specifics

- Monitor total diskon (Rp) and % of revenue
- Breakdown in 9 dimensions: Channel, Area, Toko, SPG, SKU, Gender, Series, Tier, Version
- Anomaly alerts: txn with >50% discount, SKU with avg >25% discount

## Safe edit rules

- Vanilla JS only (no bundler, no framework)
- Always test in browser before committing
- CORS locked to `https://database-zuma.github.io` on VPS nginx
- Discount derived from `price * qty - total` (field `disc_amt` also exists)

## Git

```
cd /Users/database-zuma/zuma-sales-dashboard
git add index.html
git commit -m "feat: ..."
git push origin main
```

GitHub Pages auto-deploys from `main`.
