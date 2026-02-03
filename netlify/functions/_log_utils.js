// netlify/functions/_log_utils.js
// Utilidades compartidas por las Netlify Functions.

function baseHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    ...extra,
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: baseHeaders(),
    body: JSON.stringify(obj),
  };
}

function okCors() {
  return {
    statusCode: 204,
    headers: baseHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
    body: "",
  };
}

// Normaliza RUT: quita puntos/espacios, deja guión antes del DV y DV en MAYÚSCULA
function normalizeRut(input) {
  if (!input) return "";
  let s = String(input).trim().toUpperCase();
  s = s.replace(/\./g, "").replace(/\s+/g, "");

  if (s.includes("-")) {
    const [num, dv] = s.split("-");
    if (!num || !dv) return "";
    return `${num.replace(/\D/g, "")}-${dv.replace(/[^0-9K]/g, "")}`;
  }

  const clean = s.replace(/[^0-9K]/g, "");
  if (clean.length < 2) return "";
  const num = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${num}-${dv}`;
}

// Formatea un RUT (normalizado o no) a: 12.345.678-9
function formatRut(input) {
  const n = normalizeRut(input);
  if (!n) return "";
  const [num, dv] = n.split("-");
  if (!num || !dv) return "";
  const numDots = String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${numDots}-${dv.toUpperCase()}`;
}

function nowISO() {
  return new Date().toISOString();
}

// CSV base viene con ';'
function parseCsvSemicolon(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
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

// Mapeo estándar desde abonados_base.csv
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
    entregado_base: r["Entregado"] || "",
  };
}

function groupKeyFromRow(row) {
  return normalizeRut(row?.rut_comprador || "");
}

module.exports = {
  json,
  okCors,
  normalizeRut,
  formatRut,
  nowISO,
  parseCsvSemicolon,
  mapRowFromCsv,
  groupKeyFromRow,
};
