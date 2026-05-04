// Pre-warms the Vercel edge cache for the dashboard's most common queries
// so users never hit the 30-60s cold path. Trigger options:
//   1) Vercel cron (vercel.json `crons`)
//   2) External cron service (cron-job.org / cronhub) — free
//   3) VPS cron — `curl https://zuma-api-proxy.vercel.app/api/cron/warm-cache`
//
// What it warms (per channel × per range, sku_only=true):
//   - Current year: YEAR_START → TODAY (the dashboard's default)
//   - Previous year: YEAR_START_PREV → DEC_31_PREV (full historical year)
// Last year's URL is the one that 504'd because nothing was warming it; once
// in cache it stays for 24h via the date-aware Cache-Control in [...path].js.

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
};

const CHANNELS = ['global', 'retail', 'online', 'consig', 'wholesale', 'event'];
const API_KEY = '97d25067-a2ca-44ba-ac5b-61539b627271';

function nowWIB() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}
function todayStr() {
  return nowWIB().toISOString().slice(0, 10);
}
function yearStart(year) {
  return `${year}-01-01`;
}
function yearEnd(year) {
  return `${year}-12-31`;
}

export default async function handler(req) {
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

  const today = todayStr();
  const currentYear = nowWIB().getUTCFullYear();
  const prevYear = currentYear - 1;
  const origin = new URL(req.url).origin;

  const ranges = [
    { label: 'current_ytd', from: yearStart(currentYear), to: today },
    { label: `${prevYear}_full`, from: yearStart(prevYear), to: yearEnd(prevYear) },
  ];

  const tasks = [];
  for (const range of ranges) {
    for (const channel of CHANNELS) {
      tasks.push(
        (async () => {
          const target = `${origin}/api/sales/dashboard?channel=${channel}&from=${range.from}&to=${range.to}&sku_only=true`;
          const t0 = Date.now();
          try {
            const r = await fetch(target, { headers: { 'X-API-Key': API_KEY } });
            await r.arrayBuffer();
            return {
              range: range.label,
              channel,
              status: r.status,
              ms: Date.now() - t0,
              cache: r.headers.get('x-vercel-cache') || 'unknown',
            };
          } catch (e) {
            return {
              range: range.label,
              channel,
              status: 0,
              ms: Date.now() - t0,
              error: String(e?.message || e),
            };
          }
        })(),
      );
    }
  }

  const results = await Promise.all(tasks);
  return new Response(
    JSON.stringify({ ok: true, ts: new Date().toISOString(), today, results }, null, 2),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    },
  );
}
