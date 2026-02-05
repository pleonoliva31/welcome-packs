// netlify/functions/entregar.js
const { getStore } = require("@netlify/blobs");
const { json, normalizeRut, nowISO } = require("./_log_utils");

const STORE_NAME = "welcome-packs";
const LOG_KEY = "registro_entregas_2026.csv";

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

// CSV parser simple con comillas
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

function mapRowObj(headers, cols) {
  const obj = {};
  headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
  return obj;
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
  return (s.split(" ")[0] || "").trim() || "";
}

async function readBlobText(store) {
  const blob = await store.get(LOG_KEY, { type: "text" });
  return blob || "";
}

function yaEntregadoPorRutComprador(logText, rutCompradorN) {
  const rows = parseCsv(logText, ",");
  if (rows.length < 2) return false;
  const h = rows[0].map(x => x.trim());
  const idx = h.indexOf("rut_comprador");
  if (idx === -1) return false;

  for (let i = 1; i < rows.length; i++) {
    const rc = normalizeRut(rows[i][idx] || "");
    if (rc && rc === rutCompradorN) return true;
  }
  return false;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { status: "ERROR", error: "Method not allowed" });
    }

    const siteID = process.env.BLOBS_SITE_ID;
    const token = process.env.BLOBS_TOKEN;
    if (!siteID || !token) {
      return json(500, { status: "ERROR", error: "Faltan env vars BLOBS_SITE_ID / BLOBS_TOKEN" });
    }

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { status: "ERROR", error: "Body JSON inválido" }); }

    const rut_buscado = normalizeRut(body.rut_buscado || body.rut_busqueda || "");
    const rut_receptor = normalizeRut(body.rut_receptor || "");
    const nombre_receptor = String(body.nombre_receptor || "").trim();

    if (!rut_buscado) return json(400, { status: "ERROR", error: "Falta rut_buscado" });
    if (!rut_receptor) return json(400, { status: "ERROR", error: "Falta rut_receptor" });
    if (!nombre_receptor) return json(400, { status: "ERROR", error: "Falta nombre_receptor" });

    // 1) Cargar base y armar grupo del comprador según rut_buscado
    const baseCsv = await loadText(baseUrl);
    const baseRows = parseCsv(baseCsv, ";");
    if (baseRows.length < 2) return json(404, { status: "NO_ENCONTRADO" });

    const headers = baseRows[0];
    const dataRows = baseRows.slice(1);
    const mapped = dataRows.map(cols => mapRowObj(headers, cols));

    const match = mapped.find(x => normalizeRut(x["Rut"] || "") === rut_buscado);
    if (!match) return json(404, { status: "NO_ENCONTRADO" });

    const rutCompradorN = normalizeRut(match["Rut Comprador"] || "");
    if (!rutCompradorN) return json(400, { status: "ERROR", error: "No se pudo obtener Rut Comprador del grupo" });

    const grupo = mapped.filter(x => normalizeRut(x["Rut Comprador"] || "") === rutCompradorN);

    const miembrosConPack = grupo.filter(x => packCorresponde(x["Pack"]));
    if (miembrosConPack.length === 0) {
      return json(200, { status: "NO_CORRESPONDE", message: "Este grupo no tiene welcome pack." });
    }

    // 2) Store + evitar duplicado por grupo comprador
    const store = getStore({ name: STORE_NAME, siteID, token });

    const existing = await readBlobText(store);
    if (yaEntregadoPorRutComprador(existing, rutCompradorN)) {
      return json(409, { status: "YA_ENTREGADO" });
    }

    // 3) Construir salida: header si no existe + N filas (una por miembro con pack)
    const retirado_at = nowISO();

    let out = existing;
    if (!out.trim()) {
      out =
        "rut,rut_comprador,nombre,categoria,ubicacion,fila,asiento,pack,rut_receptor,nombre_receptor,retirado_at\n";
    } else if (!out.endsWith("\n")) {
      out += "\n";
    }

    for (const m of miembrosConPack) {
      out += toCsvLine([
        normalizeRut(m["Rut"] || ""),
        rutCompradorN,
        String(m["Nombre Completo"] || "").trim(),
        String(m["Categoria"] || "").trim(),
        ubicacionMacro(m["Sector"], m["Pack"]),
        String(m["Fila"] || "").trim(),
        String(m["Asiento"] || "").trim(),
        String(m["Pack"] || "").trim(),
        rut_receptor,
        nombre_receptor,
        retirado_at
      ]);
    }

    await store.set(LOG_KEY, out, { contentType: "text/csv; charset=utf-8" });

    return json(200, {
      status: "OK",
      retirado_at,
      rut_comprador: rutCompradorN,
      filas_escritas: miembrosConPack.length
    });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
