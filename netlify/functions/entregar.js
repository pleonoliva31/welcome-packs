// netlify/functions/entregar.js
const { getStore } = require("@netlify/blobs");
const { json, okCors, normalizeRut, nowISO } = require("./_log_utils");

const STORE_NAME = "welcome-packs";
const KEY = "registro_entregas.csv";

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function toCsvLine(fields) {
  return fields.map(csvEscape).join(",") + "\n";
}

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar CSV base. HTTP ${res.status}`);
  return await res.text();
}

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

async function readBlobText(store) {
  const blob = await store.get(KEY, { type: "text" });
  return blob || "";
}

function parseLogRutCompradores(logText) {
  const lines = String(logText || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Set();

  const headers = lines[0].split(",").map((h) => h.trim());
  const idx = headers.findIndex((h) => h === "rut_comprador");
  if (idx === -1) return new Set();

  const s = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(","); // (ok mientras nombres no traigan coma)
    const rc = normalizeRut(cols[idx] || "");
    if (rc) s.add(rc);
  }
  return s;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();
    if (event.httpMethod !== "POST") return json(405, { status: "ERROR", error: "Method not allowed" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const siteID = process.env.BLOBS_SITE_ID;
    const token = process.env.BLOBS_TOKEN;
    if (!siteID || !token) {
      return json(500, { status: "ERROR", error: "Faltan env vars BLOBS_SITE_ID / BLOBS_TOKEN" });
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { status: "ERROR", error: "Body JSON inválido" }); }

    const rut_buscado = normalizeRut(body.rut_buscado || body.rut || "");
    const rut_receptor = normalizeRut(body.rut_receptor || "");
    const receptor_nombre = String(body.receptor_nombre || body.nombre_receptor || "").trim();

    if (!rut_buscado) return json(400, { status: "ERROR", error: "Falta rut_buscado" });
    if (!rut_receptor) return json(400, { status: "ERROR", error: "Falta rut_receptor" });
    if (!receptor_nombre) return json(400, { status: "ERROR", error: "Falta receptor_nombre" });

    // 1) Cargar base y armar grupo por rut_comprador del rut buscado
    const csv = await loadCsv(baseUrl);
    const { rows } = parseCsvSemicolon(csv);
    const mapped = rows.map(mapRow);

    const match = mapped.find((x) => normalizeRut(x.rut) === rut_buscado);
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    const rutCompradorN = normalizeRut(match.rut_comprador);
    const grupo = mapped.filter((x) => normalizeRut(x.rut_comprador) === rutCompradorN);

    // 2) Log (si ya existe el comprador → ya entregado todo el grupo)
    const store = getStore({ name: STORE_NAME, siteID, token });
    const existing = await readBlobText(store);
    const compradoresEnLog = parseLogRutCompradores(existing);

    if (compradoresEnLog.has(rutCompradorN)) {
      return json(409, { status: "YA_ENTREGADO" });
    }

    // 3) Append de todo el grupo con el MISMO retirado_at
    let out = existing;
    if (!out.trim()) {
      out = "rut,nombre,categoria,tribuna,sector,rut_comprador,nombre_comprador,rut_receptor,receptor_nombre,retirado_at\n";
    } else if (!out.endsWith("\n")) {
      out += "\n";
    }

    const retirado_at = nowISO();

    for (const m of grupo) {
      out += toCsvLine([
        normalizeRut(m.rut),
        String(m.nombre || "").trim(),
        String(m.categoria || "").trim(),
        String(m.tribuna || "").trim(),
        String(m.sector || "").trim(),
        rutCompradorN,
        String(m.nombre_comprador || "").trim(),
        rut_receptor,
        receptor_nombre,
        retirado_at,
      ]);
    }

    await store.set(KEY, out, { contentType: "text/csv; charset=utf-8" });

    return json(200, { status: "OK", retirado_at, rut_comprador: rutCompradorN, miembros: grupo.length });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
