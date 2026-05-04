// Pre-warms the Vercel edge cache for the dashboard's most common queries
// so users never hit the 12s cold path. Trigger options:
//   1) Vercel cron (vercel.json `crons`) — Pro plan only
//   2) External cron service (cron-job.org / cronhub) — free
//   3) VPS cron — `curl https://zuma-api-proxy.vercel.app/api/cron/warm-cache`
//
// What it does:
//   For each channel in [global, retail, online, consig, wholesale, event],
//   GET /api/sales/dashboard?channel=X&from=YEAR_START&to=TODAY&sku_only=true
//   through the public proxy URL so the response lands in Vercel edge cache.
// Returns a JSON summary of timings.

export const config = { runtime: 'edge' };

const CHANNELS = ['global', 'retail', 'online', 'consig', 'wholesale', 'event'];
const API_KEY = '97d25067-a2ca-44ba-ac5b-61539b627271';

function todayWIB() {
  // Convert UTC → Jakarta (UTC+7) so the date matches what the dashboard uses.
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}
function yearStart() {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-01-01`;
}

export default async function handler(req) {
  // Optional auth: if CRON_SECRET is set, require it via ?secret= or header.
  const secret = process.env['CRON_SECRET'];
  if (secret) {
    const url = new URL(req.url);
    const supplied = url.searchParams.get('secret') || req.headers.get('x-cron-secret');
    if (supplied !== secret) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const from = yearStart();
  const to = todayWIB();
  const origin = new URL(req.url).origin;

  const results = await Promise.all(
    CHANNELS.map(async (channel) => {
      const target = `${origin}/api/sales/dashboard?channel=${channel}&from=${from}&to=${to}&sku_only=true`;
      const t0 = Date.now();
      try {
        const r = await fetch(target, { headers: { 'X-API-Key': API_KEY } });
        const ms = Date.now() - t0;
        // Read body to make sure the edge actually fetches+stores (and to release the connection).
        await r.arrayBuffer();
        return { channel, status: r.status, ms, cache: r.headers.get('x-vercel-cache') || 'unknown' };
      } catch (e) {
        return { channel, status: 0, ms: Date.now() - t0, error: String(e && e.message || e) };
      }
    }),
  );

  return new Response(
    JSON.stringify({ ok: true, ts: new Date().toISOString(), from, to, results }, null, 2),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    },
  );
}
