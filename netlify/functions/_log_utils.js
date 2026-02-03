// netlify/functions/_log_utils.js
function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      ...extraHeaders,
    },
    body: JSON.stringify(obj),
  };
}

function okCors() {
  return { statusCode: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }, body: "" };
}

/**
 * Normaliza RUT:
 * - acepta con/sin puntos, con/sin guión, con DV k/K
 * - devuelve formato canonical: "12345678-9" o "12345678-K"
 */
function normalizeRut(input) {
  if (!input) return "";
  let s = String(input).trim().toUpperCase();

  // quitar puntos/espacios
  s = s.replace(/\./g, "").replace(/\s+/g, "");

  // permitir formatos tipo "184653710" (sin guión)
  // dejamos sólo [0-9K]
  s = s.replace(/[^0-9K]/g, "");

  if (s.length < 2) return "";

  const dv = s.slice(-1);
  const num = s.slice(0, -1).replace(/^0+/, "") || "0";

  return `${num}-${dv}`;
}

/**
 * CSV separado por ';' (tu caso)
 * OJO: asume que no hay ; dentro de los campos.
 */
function parseCsvSemicolon(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(";").map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (cols[idx] ?? "").trim()));
    rows.push(obj);
  }
  return { headers, rows };
}

function mapRowFromCsv(r) {
  return {
    rut_comprador: r["Rut Comprador"] || "",
    nombre_comprador: r["Nombre Comprador"] || "",
    email_comprador: r["Email Comprador"] || "",
    rut: r["Rut"] || "",
    nombre: r["Nombre Completo"] || "",
    categoria: r["Welcome Pack"] || "",
    tribuna: r["Tribuna"] || "",
    sector: r["Sector"] || "",
    entregado: r["Entregado"] || "",
  };
}

function groupKeyFromRow(m) {
  // grupo por rut_comprador normalizado
  return normalizeRut(m.rut_comprador);
}

function summarizeByCategory(rows) {
  const conteo = {};
  rows.forEach((m) => {
    const c = String(m.categoria || "SIN_CATEGORIA").trim().toUpperCase();
    conteo[c] = (conteo[c] || 0) + 1;
  });
  return Object.entries(conteo).map(([cat, n]) => `${n} - ${cat}`);
}

module.exports = {
  json,
  okCors,
  normalizeRut,
  parseCsvSemicolon,
  mapRowFromCsv,
  groupKeyFromRow,
  summarizeByCategory,
};
