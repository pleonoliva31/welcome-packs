// netlify/functions/buscar.js (CommonJS)
const { json, okCors, normalizeRut, formatRut } = require("./_log_utils");
const blobs = require("@netlify/blobs");

const STORE_NAME = "welcome-packs";
const LOG_KEY = "registro_entregas_2026.csv";

function getBlobsStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Blobs no configurado: faltan BLOBS_SITE_ID o BLOBS_TOKEN");

  if (typeof blobs.getStore === "function") return blobs.getStore({ name: STORE_NAME, siteID, token });
  if (typeof blobs.createClient === "function") return blobs.createClient({ siteID, token }).getStore(STORE_NAME);

  throw new Error("No se pudo inicializar Blobs: tu @netlify/blobs no expone getStore/createClient.");
}

// CSV parser simple con soporte de comillas
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  const s = String(text || "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(cur);
      cur = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      rows.push(row.map(x => x.trim()));
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row.map(x => x.trim()));
  }

  return rows.filter(r => r.some(c => String(c || "").trim() !== ""));
}

async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar base. HTTP ${res.status}`);
  return await res.text();
}

function packCorresponde(packVal) {
  const p = String(packVal || "").trim().toUpperCase();
  return (p === "SI" || p === "PREMIUM SEAT");
}

function ubicacionMacro(sectorVal, packVal) {
  const p = String(packVal || "").trim().toUpperCase();
  if (p === "PREMIUM SEAT") return "PREMIUM SEAT";

  const s = String(sectorVal || "").toUpperCase();
  if (s.includes("PRIETO")) return "PRIETO";
  if (s.includes("LEPE")) return "LEPE";
  if (s.includes("FOUILLIOUX")) return "FOUILLIOUX";
  if (s.includes("LIVINGSTONE")) return "LIVINGSTONE";
  // No inventamos OTRO; si viniera raro, caemos en la primera palabra
  return (s.split(" ")[0] || "").trim() || "";
}

function mapRowObj(headers, cols) {
  const obj = {};
  headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
  return obj;
}

async function readLogText() {
  const store = getBlobsStore();
  const t = await store.get(LOG_KEY, { type: "text" });
  return t || "";
}

function logHasComprador(logText, rutCompradorN) {
  const rows = parseCsv(logText, ",");
  if (rows.length < 2) return false;

  const h = rows[0].map(x => x.trim());
  const idxRutComprador = h.indexOf("rut_comprador");
  if (idxRutComprador === -1) return false;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rc = normalizeRut(r[idxRutComprador] || "");
    if (rc && rc === rutCompradorN) return true;
  }
  return false;
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
    const baseCsv = await loadText(baseUrl);
    const baseRows = parseCsv(baseCsv, ";");
    if (baseRows.length < 2) return json(200, { status: "NO_ENCONTRADO" });

    const headers = baseRows[0];
    const dataRows = baseRows.slice(1);

    // Normalizamos a objetos por headers EXACTOS del CSV
    const mapped = dataRows.map(cols => mapRowObj(headers, cols));

    // Buscar por Rut titular (columna "Rut")
    const match = mapped.find(x => normalizeRut(x["Rut"] || "") === rutN);
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    const rutCompradorN = normalizeRut(match["Rut Comprador"] || "");
    if (!rutCompradorN) return json(200, { status: "SIN_GRUPO" });

    const grupo = mapped.filter(x => normalizeRut(x["Rut Comprador"] || "") === rutCompradorN);

    const miembros = grupo.map(m => {
      const packRaw = m["Pack"] || "";
      const corresponde = packCorresponde(packRaw);
      return {
        rut: formatRut(m["Rut"] || ""),
        nombre: (m["Nombre Completo"] || "").trim(),
        categoria: (m["Categoria"] || "").trim(),
        ubicacion: ubicacionMacro(m["Sector"], packRaw), // PRIETO/LEPE/FOUILLIOUX/LIVINGSTONE/PREMIUM SEAT
        sector_detalle: (m["Sector"] || "").trim(),       // por si quieres mostrarlo luego
        fila: (m["Fila"] || "").trim(),
        asiento: (m["Asiento"] || "").trim(),
        pack: (m["Pack"] || "").trim(),
        pack_corresponde: corresponde
      };
    });

    const packsAEntregar = miembros.filter(x => x.pack_corresponde).length;
    const sinPack = miembros.length - packsAEntregar;

    // 2) Estado por LOG 2026
    let estado = "PENDIENTE";
    if (packsAEntregar === 0) {
      estado = "NO_CORRESPONDE";
    } else {
      const logText = await readLogText();
      const ya = logHasComprador(logText, rutCompradorN);
      estado = ya ? "YA_ENTREGADO" : "PENDIENTE";
    }

    // resumen categorías SOLO de los que tienen pack (para que el resumen sea “packs”)
    const conteo = {};
    miembros.filter(x => x.pack_corresponde).forEach(m => {
      const c = (m.categoria || "SIN_CATEGORIA").trim().toUpperCase();
      conteo[c] = (conteo[c] || 0) + 1;
    });
    const resumen = Object.entries(conteo).map(([cat, n]) => `${n} - ${cat}`);

    return json(200, {
      status: estado,
      buscado: { rut: formatRut(match["Rut"] || ""), nombre: (match["Nombre Completo"] || "").trim() },
      comprador: { rut: formatRut(match["Rut Comprador"] || ""), nombre: (match["Nombre Comprador"] || "").trim() },
      miembros,
      resumen,
      packs_a_entregar: packsAEntregar,
      sin_pack: sinPack
    });

  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
