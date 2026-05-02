// Edge proxy + cache for Zuma sales dashboard API.
// Forwards browser requests to the FastAPI backend on Hostinger VPS,
// adds CORS for GitHub Pages origin, and caches GET responses at the
// Vercel edge (sin1) so subsequent hits skip the VPS roundtrip entirely.

export const config = { runtime: 'edge' };

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

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(req.url);
  // /api/sales/dashboard?... → https://srv1346756.hstgr.cloud/api/sales/dashboard?...
  const target = `${VPS_BASE}${url.pathname}${url.search}`;

  const upstreamHeaders = {};
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) upstreamHeaders['X-API-Key'] = apiKey;
  upstreamHeaders['Accept-Encoding'] = 'gzip';

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: upstreamHeaders,
      // Vercel edge auto-caches when cf-cache-tag/cache-control set on response
      cf: { cacheTtl: 600 },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'upstream_fetch_failed', detail: String(e) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }

  // Stream the response body back. Cache GETs aggressively at edge.
  const body = await upstream.arrayBuffer();
  const responseHeaders = {
    'Content-Type': upstream.headers.get('content-type') || 'application/json',
    ...corsHeaders(origin),
  };

  if (req.method === 'GET' && upstream.ok) {
    // Edge caches for 10 min, browser revalidates after 1 min, serve stale up to 1h
    responseHeaders['Cache-Control'] = 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600';
  } else {
    responseHeaders['Cache-Control'] = 'no-store';
  }

  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
