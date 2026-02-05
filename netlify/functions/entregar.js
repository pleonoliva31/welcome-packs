// netlify/functions/entregar.js (CommonJS)
const { json, okCors, normalizeRut, stripDiacritics } = require("./_log_utils");
const blobs = require("@netlify/blobs");

const STORE_NAME = "welcome-packs";
const LOG_KEY = "registro_entregas_2026.csv";

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Faltan BLOBS_SITE_ID / BLOBS_TOKEN");

  if (typeof blobs.getStore === "function") return blobs.getStore({ name: STORE_NAME, siteID, token });
  if (typeof blobs.createClient === "function") return blobs.createClient({ siteID, token }).getStore(STORE_NAME);

  throw new Error("No se pudo inicializar @netlify/blobs (sin getStore/createClient).");
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

function cleanHeader(h) {
  return String(h || "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

function normPack(v) {
  return stripDiacritics(String(v || "")).trim().toUpperCase();
}
function packCorresponde(packRaw) {
  const p = normPack(packRaw);
  return p === "SI" || p === "PREMIUM SEAT";
}

function ubicacionMacro(packRaw, sectorRaw) {
  const p = normPack(packRaw);
  if (p === "PREMIUM SEAT") return "PREMIUM SEAT";

  const s = stripDiacritics(String(sectorRaw || "")).toUpperCase();
  if (s.includes("PRIETO")) return "PRIETO";
  if (s.includes("LEPE")) return "LEPE";
  if (s.includes("FOUILLIOUX")) return "FOUILLIOUX";
  if (s.includes("LIVINGSTONE")) return "LIVINGSTONE";
  return "";
}

function mapRowObj(headers, cols) {
  const obj = {};
  headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
  return obj;
}

// CSV safe cell (comillas si hace falta)
function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function nowChileISO() {
  // guardamos en formato ISO “local Chile” sin Z
  // Ojo: esto asume Chile continental UTC-3 como pediste.
  const d = new Date(Date.now() - (3 * 60 * 60 * 1000));
  return d.toISOString().replace("Z", "");
}

function logHasComprador(logText, rutCompradorN) {
  const rows = parseCsv(logText, ",");
  if (rows.length < 2) return false;

  const h = rows[0].map(x => cleanHeader(x).toLowerCase());
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
    if (event.httpMethod !== "POST") return json(405, { status: "ERROR", error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const rutBuscadoN = normalizeRut(body.rut_buscado || "");
    const rutReceptorN = normalizeRut(body.rut_receptor || "");
    const nombreReceptor = String(body.nombre_receptor || "").trim();

    if (!rutBuscadoN) return json(400, { status: "ERROR", error: "Falta rut_buscado" });
    if (!rutReceptorN || !nombreReceptor) return json(400, { status: "ERROR", error: "Faltan datos del receptor" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    // 1) Cargar base y armar grupo
    const baseCsv = await loadText(baseUrl);
    const baseRows = parseCsv(baseCsv, ";");
    if (baseRows.length < 2) return json(200, { status: "NO_ENCONTRADO" });

    const headers = baseRows[0].map(cleanHeader);
    const rows = baseRows.slice(1).map(cols => mapRowObj(headers, cols));

    // Buscar por Rut o por Rut Comprador
    const match = rows.find(x =>
      normalizeRut(x["Rut"] || "") === rutBuscadoN ||
      normalizeRut(x["Rut Comprador"] || "") === rutBuscadoN
    );
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    const rutCompradorN = normalizeRut(match["Rut Comprador"] || "");
    if (!rutCompradorN) return json(200, { status: "SIN_GRUPO" });

    const grupo = rows.filter(x => normalizeRut(x["Rut Comprador"] || "") === rutCompradorN);

    // Miembros que sí tienen pack
    const conPack = grupo.map(m => {
      const packRaw = m["Pack"] || "";
      const corresponde = packCorresponde(packRaw);
      return {
        rut: normalizeRut(m["Rut"] || ""),
        rut_raw: String(m["Rut"] || "").trim(),
        rut_comprador_raw: String(m["Rut Comprador"] || "").trim(),
        nombre: String(m["Nombre Completo"] || "").trim(),
        categoria: String(m["Categoria"] || "").trim(),
        sector: String(m["Sector"] || "").trim(),
        ubicacion: ubicacionMacro(packRaw, m["Sector"]),
        fila: String(m["Fila"] || "").trim(),
        asiento: String(m["Asiento"] || "").trim(),
        pack: String(m["Pack"] || "").trim(),
        corresponde
      };
    }).filter(x => x.rut && x.corresponde);

    if (conPack.length === 0) {
      return json(200, { status: "NO_CORRESPONDE", error: "Este grupo no tiene welcome pack." });
    }

    // 2) Log: si ya existe entrega para ese comprador, no duplicamos
    const store = getStore();
    const logText = (await store.get(LOG_KEY, { type: "text" })) || "";

    if (logHasComprador(logText, rutCompradorN)) {
      return json(200, { status: "YA_ENTREGADO" });
    }

    // 3) Construir filas log (una por miembro con pack)
    const retiradoAt = nowChileISO();

    const headerWanted = [
      "rut",
      "rut_comprador",
      "nombre",
      "categoria",
      "ubicacion",
      "fila",
      "asiento",
      "pack",
      "rut_receptor",
      "nombre_receptor",
      "retirado_at"
    ].join(",");

    const lines = [];
    for (const m of conPack) {
      lines.push([
        csvCell(m.rut_raw || ""),
        csvCell(m.rut_comprador_raw || ""),
        csvCell(m.nombre || ""),
        csvCell(m.categoria || ""),
        csvCell(m.ubicacion || ""),
        csvCell(m.fila || ""),
        csvCell(m.asiento || ""),
        csvCell(m.pack || ""),
        csvCell(String(body.rut_receptor || "").trim()),
        csvCell(nombreReceptor),
        csvCell(retiradoAt)
      ].join(","));
    }

    let newLog = logText;

    if (!newLog.trim()) {
      newLog = headerWanted + "\n" + lines.join("\n") + "\n";
    } else {
      // asegurar header correcto; si no, igual append debajo
      const hasHeader = newLog.split(/\r?\n/)[0].trim().toLowerCase().includes("rut_comprador");
      if (!hasHeader) {
        newLog = headerWanted + "\n" + newLog.trim() + "\n" + lines.join("\n") + "\n";
      } else {
        if (!newLog.endsWith("\n")) newLog += "\n";
        newLog += lines.join("\n") + "\n";
      }
    }

    await store.set(LOG_KEY, newLog, { contentType: "text/csv; charset=utf-8" });

    return json(200, {
      status: "OK",
      rut_comprador: match["Rut Comprador"] || "",
      packs_registrados: conPack.length,
      retirado_at: retiradoAt
    });

  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
