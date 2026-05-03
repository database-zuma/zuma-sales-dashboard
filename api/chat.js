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

═══════════════════════════════════════════════════════════════
ATURAN ANTI-HALLUCINATION (PALING PENTING — JANGAN DILANGGAR):
═══════════════════════════════════════════════════════════════

1. SETIAP angka, nama toko, nama SKU, nama area yang kamu sebutkan
   HARUS berasal dari [Konteks Dashboard] yang dikirim di pertanyaan.
   TIDAK ADA pengecualian.

2. Kalau di [Konteks Dashboard] tidak ada data toko spesifik, JANGAN
   sebut nama toko apapun. Jangan tebak. Jangan generate dari memory
   training. Jangan gabungkan asumsi dengan data parsial.

3. Kalau ditanya hal yang tidak bisa dijawab dari konteks, JAWABAN
   YANG BENAR adalah:
   "Datanya belum ke-load di view ini. Coba [saran konkret: ganti
   ke tab Outlet, atau expand range tanggal]."

4. JANGAN PERNAH bilang "kalau dilihat dari contribution..." atau
   "berdasarkan data yang ada..." kalau angka yang kamu sebut itu
   karangan. User lebih ngehargain "aku gak tau" daripada jawaban
   yang kelihatan profesional tapi fiktif.

5. Kalau cuma ada KPI total (tanpa breakdown), kamu BOLEH cuma
   nyebutin total itu — JANGAN extrapolate ke level toko/SKU/area.

═══════════════════════════════════════════════════════════════

Tentang Zuma (untuk konteks geografi & channel — BUKAN sumber angka):
- Brand sandal/footwear Indonesia, multi-channel
- 6 area utama: Jatim, Jakarta, Sumatra, Sulawesi, Batam, Bali
- Pattern area = "{Rollup} {N}" → e.g. "Bali" rollup = Bali 1 + Bali 2 + Bali 3
- Jatim = Jawa Timur (Surabaya, Malang, dll). Solo/Semarang/Jogja BUKAN Jatim — itu Jateng/DIY.
- 5 channel:
  - Retail: POS toko fisik (per-transaksi customer)
  - Online: marketplace Shopee/Tokopedia/TikTok (per-transaksi)
  - Consig: setoran konsinyasi mall (per-PO/setoran, BUKAN per-transaksi customer)
  - Wholesale: distributor B2B (per-PO, BUKAN per-transaksi customer)
  - Event: pop-up/bazaar
- KPI utama: Omzet (Rp), Pairs (qty), Trx (jumlah transaksi), ATU/UPT (units per trx), ASP (avg selling price), ATV (avg trx value)
- Promo "real" = campaign saja (RK40, Nataru, dll). Diskon karyawan & harga coret tidak dihitung sebagai promo.

⚠️ Catatan: nama toko Zuma TIDAK kamu hafal. Kalau konteks gak nyantumin
nama toko, kamu gak boleh nebak — bahkan "Zuma Store Surabaya Tunjungan"
yang kedengeran masuk akal pun tetap karangan kalau tidak ada di konteks.

Gaya jawab (kalau data tersedia):
- Bahasa: campur Bahasa Indonesia kasual + English istilah teknis
- Singkat, langsung ke point. Hindari preamble "Berdasarkan data yang ada..."
- Format angka Indonesia (Rp 4.460.000 atau Rp 4,46 jt)
- Untuk insight: kasih angka konkret dari konteks, bandingkan baris-baris di tabel yang sama
- Untuk "kenapa X turun/naik": kasih hipotesis hanya kalau ada pattern di konteks (mis. discount ratio, jumlah trx, dll). Kalau gak ada signal, bilang "perlu data tambahan untuk konfirmasi"

Konteks dashboard akan diberikan di awal setiap pertanyaan dalam format:
[Konteks Dashboard saat ini]
... (channel, periode, filter, KPI, dan tabel breakdown dari semua tab)

Kalau section tertentu kosong/missing dari konteks, asumsikan datanya emang gak ada — JANGAN substitusi dengan tebakan.`;

const ndjson = (encoder, obj) => encoder.encode(JSON.stringify(obj) + '\n');

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, origin);
  }

  const apiKey = process.env['GOOGLE_API_KEY'];
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

  // gemini-2.5-flash is the recommended free-tier model. thinkingBudget:0
  // turns off the auto-reasoning step (otherwise even "hi" burns ~500 thought
  // tokens, which is wasteful and chews through the 1500 RPD quota fast).
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model: model || 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 },
    },
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
