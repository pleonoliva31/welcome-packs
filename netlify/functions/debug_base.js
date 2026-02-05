// netlify/functions/debug_base.js
const { json, okCors } = require("./_log_utils");

async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar BASE_CSV_URL. HTTP ${res.status}`);
  return await res.text();
}

function parseSemicolonSimple(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(";").map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (cols[idx] ?? "").trim());
    rows.push(obj);
  }
  return { headers, rows };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();
    if (event.httpMethod !== "GET") return json(405, { ok:false, error:"Method not allowed" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { ok:false, error:"Falta BASE_CSV_URL" });

    const raw = await loadText(baseUrl);
    const { headers, rows } = parseSemicolonSimple(raw);

    return json(200, {
      ok: true,
      base_url: baseUrl,
      headers,
      sample_count: Math.min(rows.length, 5),
      samples: rows.slice(0, 5),
      total_rows: rows.length
    });
  } catch (e) {
    return json(500, { ok:false, error: String(e?.message || e) });
  }
};
