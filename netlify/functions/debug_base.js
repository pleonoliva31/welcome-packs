// netlify/functions/debug_base.js
const {
  json,
  okCors,
  parseCsvSemicolon,
  mapRowFromCsv,
} = require("./_log_utils");

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar CSV. HTTP ${res.status}`);
  return await res.text();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();

  try {
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { ok: false, error: "Falta BASE_CSV_URL" });

    const csv = await loadCsv(baseUrl);
    const { headers, rows } = parseCsvSemicolon(csv);
    const ejemplos = rows.slice(0, 3).map((r) => ({
      raw: r,
      mapeado: mapRowFromCsv(r),
    }));

    return json(200, {
      ok: true,
      delim_usado: ";",
      headers_originales: headers,
      ejemplos,
      filas: rows.length,
    });
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
};
