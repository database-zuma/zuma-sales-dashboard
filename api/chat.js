// AI chat assistant for the Zuma sales dashboard.
// Streams from Google Gemini API via an edge function so the API key never
// reaches the browser. The browser sends { messages, context, model? } and
// receives a normalized NDJSON stream: one {"type":"text","text":"..."} per
// chunk, plus a final {"type":"done"} or {"type":"error","message":"..."}.

import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = { runtime: 'edge' };

const ALLOWED_ORIGINS = [
  'https://database-zuma.github.io',
  'https://zuma-api-proxy.vercel.app',
  'http://localhost:3000',
  'http://localhost:8000',
];

const corsHeaders = (origin) => {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
};

const json = (status, body, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });

const SYSTEM_PROMPT = `Kamu adalah asisten analitik untuk dashboard penjualan Zuma Indonesia.

Tentang Zuma:
- Brand sandal/footwear Indonesia, multi-channel
- 6 area: Jatim, Jakarta, Sumatra, Sulawesi, Batam, Bali
- 5 channel:
  - Retail: POS toko fisik (per-transaksi customer)
  - Online: marketplace Shopee/Tokopedia/TikTok (per-transaksi)
  - Consig: setoran konsinyasi mall (per-PO/setoran, BUKAN per-transaksi customer)
  - Wholesale: distributor B2B (per-PO, BUKAN per-transaksi customer)
  - Event: pop-up/bazaar
- KPI utama: Omzet (Rp), Pairs (qty), Trx (jumlah transaksi), UPT (units per trx), ASP (avg selling price), ATV (avg trx value)
- Promo "real" = campaign saja (RK40, Nataru, dll). Diskon karyawan & harga coret tidak dihitung sebagai promo.

Gaya jawab:
- Bahasa: campur Bahasa Indonesia kasual + English istilah teknis (sesuai gaya user di Jakarta tech)
- Singkat, langsung ke point. Hindari preamble "Berdasarkan data yang ada..."
- Format angka Indonesia (Rp 4.460.000 dengan titik, atau Rp 4,46 jt untuk ringkas)
- Untuk insight: kasih angka konkret, bukan "performanya bagus". Bandingkan dengan period/area/SKU lain kalau bisa.
- Kalau data yang dibutuhkan tidak ada di konteks dashboard, bilang aja "datanya belum ke-load di dashboard, coba expand range tanggal atau ganti channel" — JANGAN ngarang angka.
- Untuk pertanyaan "kenapa X turun/naik": kasih hipotesis berdasarkan pattern data yang ada, bukan asumsi liar.

Konteks dashboard saat ini akan diberikan di awal setiap pertanyaan.`;

const ndjson = (encoder, obj) => encoder.encode(JSON.stringify(obj) + '\n');

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, origin);
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'missing_api_key', detail: 'Set GOOGLE_API_KEY env var on Vercel.' }, origin);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' }, origin);
  }

  const { messages, context, model } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages_required' }, origin);
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return json(400, { error: 'invalid_message_shape' }, origin);
    }
  }

  // Inject dashboard context as a prefix to the latest user message.
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break; }
  }
  const apiMessages = messages.map((m, i) => {
    if (i === lastUserIdx && context) {
      return { role: 'user', content: `[Konteks Dashboard saat ini]\n${context}\n\n[Pertanyaan]\n${m.content}` };
    }
    return { role: m.role, content: m.content };
  });

  // Convert to Gemini format: 'assistant' → 'model', content → parts[].text.
  const geminiContents = apiMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model: model || 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
  });

  let result;
  try {
    result = await geminiModel.generateContentStream({ contents: geminiContents });
  } catch (e) {
    return json(502, { error: 'gemini_request_failed', detail: String(e && e.message || e) }, origin);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = (typeof chunk.text === 'function') ? chunk.text() : '';
          if (text) controller.enqueue(ndjson(encoder, { type: 'text', text }));
        }
        controller.enqueue(ndjson(encoder, { type: 'done' }));
      } catch (e) {
        controller.enqueue(ndjson(encoder, { type: 'error', message: String(e && e.message || e) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(origin),
    },
  });
}
