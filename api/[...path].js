// Proxy + cache for Zuma sales dashboard API.
// Forwards browser requests to the FastAPI backend on Hostinger VPS, adds CORS
// for GitHub Pages, and caches GET responses at the Vercel edge.
//
// Runtime: Node.js (Fluid Compute) — needs longer timeout than Edge gives us.
// Cold-path queries on full-year aggregations (e.g., 2025 global YTD) can take
// 30-60s on the VPS, which exceeds Edge's 30s wall-clock. Node lets us extend.
//
// Cache strategy is date-aware:
//   - Historical ranges (to date < current year): aggressive 24h cache, since
//     past-year sales data is effectively immutable (no backdated entries this
//     long after the fact).
//   - Current-year / today: 5 min cache + stale-while-revalidate so iSeller
//     uploads land in the dashboard within a few minutes.

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const VPS_BASE = 'https://srv1346756.hstgr.cloud';
const ALLOWED_ORIGINS = [
  'https://database-zuma.github.io',
  'http://localhost:3000',
  'http://localhost:8000',
];

const corsHeaders = (origin) => {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
};

// Decide cache TTL based on the requested `to` date. Historical ranges get
// aggressive caching since past sales data does not change.
function cacheControlFor(searchParams) {
  const to = searchParams.get('to');
  if (to) {
    const toYear = parseInt(to.slice(0, 4), 10);
    const currentYear = new Date().getUTCFullYear();
    if (toYear < currentYear) {
      // Historical: cache 1 day at edge, 1h browser, stale-while-revalidate 7d
      return 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
    }
  }
  // Current / unknown: keep tight TTL so freshly synced data appears within ~5 min.
  return 'public, max-age=60, s-maxage=300, stale-while-revalidate=14400';
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(req.url);
  const target = `${VPS_BASE}${url.pathname}${url.search}`;

  const upstreamHeaders = {};
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) upstreamHeaders['X-API-Key'] = apiKey;
  upstreamHeaders['Accept-Encoding'] = 'gzip';

  // Hard cap fetch at 55s so we can return a clean 504 before Vercel kills us at 60s.
  const ac = new AbortController();
  const abortTimer = setTimeout(() => ac.abort(), 55_000);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: upstreamHeaders,
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(abortTimer);
    const isTimeout = e?.name === 'AbortError';
    return new Response(
      JSON.stringify({
        error: isTimeout ? 'upstream_timeout' : 'upstream_fetch_failed',
        detail: String(e?.message || e),
        hint: isTimeout
          ? 'VPS aggregation took > 55s. Try a shorter date range or wait for cron warm-up.'
          : undefined,
      }),
      {
        status: isTimeout ? 504 : 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      },
    );
  }
  clearTimeout(abortTimer);

  const body = await upstream.arrayBuffer();
  const responseHeaders = {
    'Content-Type': upstream.headers.get('content-type') || 'application/json',
    ...corsHeaders(origin),
  };

  if (req.method === 'GET' && upstream.ok) {
    responseHeaders['Cache-Control'] = cacheControlFor(url.searchParams);
  } else {
    responseHeaders['Cache-Control'] = 'no-store';
  }

  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
