// netlify/functions/buscar.js (CommonJS)

const { json, okCors, normalizeRut, formatRut } = require("./_log_utils");

// Compatibilidad con distintas versiones de @netlify/blobs
const blobs = require("@netlify/blobs");

function getBlobsStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  const name = "welcome-packs";

  if (!siteID || !token) {
    throw new Error("Blobs no configurado: faltan BLOBS_SITE_ID o BLOBS_TOKEN");
  }

  // v0.6+ (típico)
  if (typeof blobs.getStore === "function") {
    return blobs.getStore({ name, siteID, token });
  }

  // alternativas (según versión)
  if (typeof blobs.createClient === "function") {
    const client = blobs.createClient({ siteID, token });
    if (typeof client.getStore === "function") return client.getStore(name);
  }

  throw new Error("No se pudo inicializar Blobs: tu @netlify/blobs no expone getStore/createClient.");
}

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar CSV base. HTTP ${res.status}`);
  return await res.text();
}

function parseCsvSemicolon(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
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

function mapRow(r) {
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

async function readLogCsvText() {
  const store = getBlobsStore();
  const key = "registro_entregas.csv";
  const t = await store.get(key, { type: "text" });
  return t || "";
}

function parseLogCsvSimple(logText) {
  const lines = logText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (cols[idx] ?? "").trim()));
    out.push(obj);
  }
  return out;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const rutQuery = event.queryStringParameters?.rut || "";
    const rutN = normalizeRut(rutQuery);
    if (!rutN) return json(400, { status: "ERROR", error: "Falta rut" });

    // 1) Base
    const csv = await loadCsv(baseUrl);
    const { rows } = parseCsvSemicolon(csv);
    const mapped = rows.map(mapRow);

    const match = mapped.find((x) => normalizeRut(x.rut) === rutN);
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    const rutCompradorN = normalizeRut(match.rut_comprador);
    const grupo = mapped.filter((x) => normalizeRut(x.rut_comprador) === rutCompradorN);

    const miembros = grupo.map((m) => ({
      rut: formatRut(m.rut),
      nombre: m.nombre,
      categoria: (m.categoria || "").trim(),
      tribuna: (m.tribuna || "").trim(),
      sector: (m.sector || "").trim(),
    }));

    // resumen
    const conteo = {};
    grupo.forEach((m) => {
      const c = (m.categoria || "SIN_CATEGORIA").trim().toUpperCase();
      conteo[c] = (conteo[c] || 0) + 1;
    });
    const resumen = Object.entries(conteo).map(([cat, n]) => `${n} - ${cat}`);

    // 2) Estado por LOG (verdadero) + fallback base
    let estado = "PENDIENTE";

    const logText = await readLogCsvText();
    const logRows = parseLogCsvSimple(logText);

    const yaEntregadoPorLog = logRows.some((r) => normalizeRut(r.rut_comprador) === rutCompradorN);
    const yaEntregadoPorBase = grupo.some((m) => String(m.entregado_base || "").trim() !== "");

    if (yaEntregadoPorLog || yaEntregadoPorBase) estado = "YA_ENTREGADO";

    return json(200, {
      status: estado,
      buscado: { rut: formatRut(match.rut), nombre: match.nombre },
      comprador: { rut: formatRut(match.rut_comprador), nombre: match.nombre_comprador },
      miembros,
      resumen,
    });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
