# Zuma Sales Dashboard — Handoff (session 2026-04-23)

**Repo**: `/Users/database-zuma/zuma-sales-dashboard/` · GitHub: `database-zuma/zuma-sales-dashboard`
**Live**: https://database-zuma.github.io/zuma-sales-dashboard/
**Current version**: `v1.8` (footer + APP_VERSION) · CACHE_PREFIX `zuma-sales-v4:`

## Stack
- Vanilla HTML + CSS + JS single file (`index.html`) · Chart.js CDN
- GitHub Pages auto-deploy from `main`
- Backend FastAPI on VPS `srv1346756.hstgr.cloud`. SSH: `ssh vps-db`. Main route file: `/opt/zuma-api/routes/sales_dashboard.py`
- API key: `97d25067-a2ca-44ba-ac5b-61539b627271` · Header: `X-API-Key`

## 9 Tabs status
Executive · Outlet · Produk · Trend · Hourly · SPG · Target · Refund · Promo — all functional. Multi-select filters (Area/Toko/Gender/Series/Tier) with search in Toko+Series. SKU typeahead chip multi-select. Backend `/api/sales/filter-options` endpoint provides full ref list.

## 🔧 Pending fixes (agreed with user, not yet pushed)

1. **ASP/ATV exact format** — create `fmtRpExact(n) = 'Rp ' + n.toLocaleString('id-ID')` (e.g. "Rp 167.420"). Apply to ASP + ATV columns in Executive Performance table, Outlet Ranking, SPG Leaderboard. KPI card Revenue/Omzet stays on `fmtRpShort`.

2. **Distribusi Size title** — HTML: remove "(ascending)" — keep only "Distribusi Size".

3. **Size labels visible in chart** — chartProdukSize currently has 30 green bars but Y-axis size labels overlap/hide. Fix via y-axis config: `ticks: { autoSkip: false, font: {size: 11} }` + increase chart height to ~320px (or dynamic based on bySize.length).

4. **Hourly tab → Retail-only** — for channels Online/Consig/Wholesale/**Global** → hide chart + Breakdown Jam table, show empty state "Data per jam hanya tersedia untuk channel Retail". Only Retail channel renders normally.

5. **SPG tab → Retail-only** — same pattern as Hourly. Empty state for Online/Consig/Wholesale/**Global**. Only Retail renders. User explicitly said: "mending gausah di global, soalnya itu bisa dilihat di retail".

6. **Target tab — Online support**:
   - `/opt/zuma-api/sync_targets.py` has line: `SKIP_STORES = {'konsinyasi','konsinnyasi','event','bazaar','afiliasi','online','ddd','ubb','mbb','ljbb'}`
   - Remove `'online'` from SKIP_STORES
   - Run: `ssh vps-db "cd /opt/zuma-api && .venv/bin/python sync_targets.py"`
   - Verify: `curl -H 'X-API-Key: ...' https://srv1346756.hstgr.cloud/api/targets | grep -i online`
   - User confirmed target Online exists in the Google Sheet source

7. **Target name matching fuzzy** — in `renderTarget()` in index.html, some rows show "Actual Rp 0" because target name ("Pepito") doesn't match `data.byEntity.name` ("Zuma Pepito Bali"). Use substring match:
   ```js
   const actual = rev.find(e => {
     const a = String(e.name || '').toLowerCase();
     const b = String(target.storeName || '').toLowerCase();
     return a.includes(b) || b.includes(a);
   })?.revenue || 0;
   ```

## After all fixes
- Bump `APP_VERSION` → `'v1.9'` in index.html
- Bump `CACHE_PREFIX` → `'zuma-sales-v5:'` so client localStorage auto-invalidates
- Update footer buildStamp → `v1.9 · build 2026-04-24 · <summary>`
- Commit + push, wait for deploy (`until curl ... | grep -q v1.9`)

## Design/engineering rules
- Always `Read` file before `Edit` (hook enforces this)
- Restart backend after sales_dashboard.py edit: `ssh vps-db "systemctl restart zuma-api && sleep 2 && systemctl is-active zuma-api"` (clears in-memory cache)
- Backend cache key is `sales_dashboard_v5_{ch}_{start}_{end}_s{0|1}_{filter_sig}` — schema changes require bumping to v6
- CORS allows only `https://database-zuma.github.io` (VPS nginx `/etc/nginx/sites-available/zuma-api`)

## ✅ Last verified state (what already works)
- byEntity grouped by (entity, area) so Outlet shows Shopee Jakarta + Shopee Bali as separate rows
- Online transactions counted via `nomor_invoice` LATERAL JOIN to raw.accurate_sales_mbb on (date, UPPER(kode_produk)=UPPER(kode_besar), qty, total)
- Consig entity uses `s.toko` not `s.customer` → shows "Zuma Pepito Bali" not "PT. Sentral Retailindo Dewata"
- Consig excludes rows with branch='Online' or toko='online' (Shopee/etc were leaking from NON-RETAIL tag)
- Online whitelist: Shopee / Tokopedia / TikTok / Lazada / Blibli / Bukalapak only
- Executive Performance table collapses byEntity rows by name (no Area col, total Pairs combined)
- Outlet Ranking keeps Area split (retains per-(entity, area) rows from backend)
- Entity names lowercase auto title-cased via `titleCaseEntity(s)` helper
- UPT label renamed to ATU (metric definition identical: pairs / transactions)
- Auto-clear localStorage on APP_VERSION mismatch (so user never sees stale schema)
- Meta `Cache-Control: no-cache, no-store, must-revalidate` in `<head>` to bust browser HTML cache
