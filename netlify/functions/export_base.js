// netlify/functions/export_base.js
const { json, okCors, parseCsvSemicolon, mapRowFromCsv, normalizeRut } = require("./_log_utils");

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar CSV. HTTP ${res.status}`);
  return await res.text();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();

  try {
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const csv = await loadCsv(baseUrl);
    const { rows } = parseCsvSemicolon(csv);
    const mapped = rows.map(mapRowFromCsv).map((m) => ({
      ...m,
      rut: normalizeRut(m.rut),
      rut_comprador: normalizeRut(m.rut_comprador),
    }));

    return json(200, { status: "OK", rows: mapped, total: mapped.length });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
