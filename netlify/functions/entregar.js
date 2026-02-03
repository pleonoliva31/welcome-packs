// netlify/functions/entregar.js (CommonJS)

const { json, okCors, normalizeRut, formatRut, nowIsoChile } = require("./_log_utils");
const blobs = require("@netlify/blobs");

function getBlobsStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  const name = "welcome-packs";

  if (!siteID || !token) {
    throw new Error("Blobs no configurado: faltan BLOBS_SITE_ID o BLOBS_TOKEN");
  }

  if (typeof blobs.getStore === "function") {
    return blobs.getStore({ name, siteID, token });
  }

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
    rut: r["Rut"] || "",
    nombre: r["Nombre Completo"] || "",
    categoria: r["Welcome Pack"] || "",
    tribuna: r["Tribuna"] || "",
    sector: r["Sector"] || "",
  };
}

async function getLogText() {
  const store = getBlobsStore();
  const key = "registro_entregas.csv";
  const t = await store.get(key, { type: "text" });
  return t || "";
}

async function setLogText(newText) {
  const store = getBlobsStore();
  const key = "registro_entregas.csv";
  await store.set(key, newText, { contentType: "text/csv; charset=utf-8" });
}

function ensureLogHeader(logText) {
  const header =
    "fecha_hora,rut_comprador,nombre_comprador,rut_receptor,nombre_receptor,cant_total,detalle_categorias,miembros\n";
  if (!logText || !logText.trim()) return header;
  if (logText.startsWith("fecha_hora,")) return logText;
  return header + logText.trim() + "\n";
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
    if (event.httpMethod !== "POST") {
      return json(405, { status: "ERROR", error: "Método no permitido" });
    }

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const body = event.body ? JSON.parse(event.body) : {};

    const rutBuscadoN = normalizeRut(body.rut_buscado || body.rut || "");
    const rutReceptorN = normalizeRut(body.rut_receptor || "");
    const nombreReceptor = String(body.nombre_receptor || "").trim();

    if (!rutBuscadoN) return json(400, { status: "ERROR", error: "Falta rut_buscado" });
    if (!rutReceptorN) return json(400, { status: "ERROR", error: "Falta rut_receptor" });
    if (!nombreReceptor) return json(400, { status: "ERROR", error: "Falta nombre_receptor" });

    // 1) Buscar en base el rut buscado y su grupo
    const csv = await loadCsv(baseUrl);
    const { rows } = parseCsvSemicolon(csv);
    const mapped = rows.map(mapRow);

    const match = mapped.find((x) => normalizeRut(x.rut) === rutBuscadoN);
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    const rutCompradorN = normalizeRut(match.rut_comprador);
    const grupo = mapped.filter((x) => normalizeRut(x.rut_comprador) === rutCompradorN);

    if (!grupo.length) return json(200, { status: "ERROR", error: "Sin datos de grupo." });

    // 2) Validar que receptor esté dentro del grupo
    const receptorEstaEnGrupo = grupo.some((m) => normalizeRut(m.rut) === rutReceptorN);
    if (!receptorEstaEnGrupo) {
      return json(200, {
        status: "ERROR_RECEPTOR",
        error: "El RUT ingresado no corresponde a este abono",
      });
    }

    // 3) Evitar doble entrega por rut_comprador usando LOG
    let logText = await getLogText();
    logText = ensureLogHeader(logText);
    const logRows = parseLogCsvSimple(logText);

    const yaEntregado = logRows.some((r) => normalizeRut(r.rut_comprador) === rutCompradorN);
    if (yaEntregado) {
      return json(200, { status: "YA_ENTREGADO" });
    }

    // 4) Construir detalle y guardar
    const conteo = {};
    grupo.forEach((m) => {
      const c = (m.categoria || "SIN_CATEGORIA").trim().toUpperCase();
      conteo[c] = (conteo[c] || 0) + 1;
    });
    const detalleCategorias = Object.entries(conteo)
      .map(([cat, n]) => `${n} - ${cat}`)
      .join(" | ");

    const miembrosStr = grupo
      .map((m) => `${formatRut(m.rut)}:${(m.nombre || "").replace(/,/g, " ")}`)
      .join(" ; ");

    const line = [
      nowIsoChile(),
      formatRut(match.rut_comprador),
      (match.nombre_comprador || "").replace(/,/g, " "),
      formatRut(rutReceptorN),
      nombreReceptor.replace(/,/g, " "),
      String(grupo.length),
      detalleCategorias.replace(/,/g, " "),
      miembrosStr.replace(/,/g, " "),
    ].join(",");

    const newLog = (logText.trimEnd() + "\n" + line + "\n").replace(/\n{3,}/g, "\n\n");
    await setLogText(newLog);

    return json(200, { status: "OK" });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
