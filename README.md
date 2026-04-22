# Zuma Sales Analytics

Standalone sales analytics dashboard untuk Zuma Indonesia — 5 channel (Global · Retail · Online · Consignment · Wholesale) dalam satu tampilan unified.

## URL
- Production: https://database-zuma.github.io/zuma-sales-dashboard/

## Stack
- Vanilla HTML + CSS + JS (single-file)
- Chart.js via CDN
- Backend: shared API `srv1346756.hstgr.cloud` (FastAPI + PostgreSQL on VPS)
- Auth: `X-API-Key` header
- Deploy: GitHub Pages (auto from `main`)

## Tabs
1. **Executive** — KPI ring (Omzet/Pairs/Trx/UPT/ASP/ATV), Sales Over Time, Contribution pie, Performance table
2. **Outlet** — Breakdown per toko/marketplace/partner/customer
3. **Produk** — Top SKU + Gender/Series/Tier/Tipe analysis
4. **Trend** — Daily/Monthly/YoY
5. **Hourly** — Jam × hari heatmap
6. **SPG** — Leaderboard SPG (retail)
7. **Target** — Target vs Actual achievement
8. **Refund** — Refund monitor + anomaly
9. **Promo** — Total diskon Rp + % dari omzet, breakdown 9 dimensi

Layout identik lintas channel — switch channel hanya mengubah data, bukan tata letak.

## Dev

Open `index.html` di browser. Gunakan Live Server VS Code atau `python -m http.server` untuk dev.

## Deploy

Push ke `main` → GitHub Pages auto-deploy.

## Notes
- CORS VPS nginx harus allow origin `https://database-zuma.github.io` (sudah aktif)
- API key hardcoded (internal tool, audience terbatas)
