// netlify/functions/export_pendientes.js
const { json, okCors, parseCsvSemicolon, mapRowFromCsv, normalizeRut, groupKeyFromRow } = require("./_log_utils");
const { createClient } = require("@netlify/blobs");

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Falta BLOBS_SITE_ID o BLOBS_TOKEN.");
  const client = createClient({ siteID, token });
  return client.getStore("welcome-pack-logs");
}

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
    const base = rows.map(mapRowFromCsv);

    // set de grupos entregados
    const store = getStore();
    const deliveredKeys = new Set();
    let cursor = undefined;
    while (true) {
      const res = await store.list({ cursor, limit: 200 });
      for (const b of res.blobs) deliveredKeys.add(b.key); // key = rut_comprador normalizado
      if (!res.next_cursor) break;
      cursor = res.next_cursor;
    }

    // pendientes = filas cuyo grupo (rut_comprador) no está en deliveredKeys
    const pendientes = base
      .filter((r) => !deliveredKeys.has(groupKeyFromRow(r)))
      .map((m) => ({
        rut: normalizeRut(m.rut),
        nombre: m.nombre,
        categoria: m.categoria,
        tribuna: m.tribuna,
        sector: m.sector,
        rut_comprador: normalizeRut(m.rut_comprador),
        nombre_comprador: m.nombre_comprador,
        email_comprador: m.email_comprador,
      }));

    return json(200, { status: "OK", rows: pendientes, total: pendientes.length });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
