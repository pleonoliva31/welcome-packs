// netlify/functions/metrics.js
const { json, okCors, normalizeRut } = require("./_log_utils");
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

// CSV parser con comillas
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();
    if (event.httpMethod !== "GET") return json(405, { status: "ERROR", error: "Method not allowed" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    // 1) Base completa (todos los abonados)
    const baseCsv = await loadText(baseUrl);
    const baseRows = parseCsv(baseCsv, ";");
    if (baseRows.length < 2) {
      return json(200, { status: "OK", total_abonados: 0, total_base: 0, total_entregados: 0, pct_total: 0, por_categoria: [], por_ubicacion: [] });
    }

    const headers = baseRows[0];
    const dataRows = baseRows.slice(1);
    const mapped = dataRows.map(cols => mapRowObj(headers, cols));

    const totalAbonados = mapped.length;

    // Packs entregables (SI o PREMIUM SEAT)
    const packs = mapped
      .map(r => ({
        rut: normalizeRut(r["Rut"] || ""),
        categoria: String(r["Categoria"] || "").trim().toUpperCase(),
        ubicacion: ubicacionMacro(r["Sector"], r["Pack"]),
        pack_raw: String(r["Pack"] || "").trim(),
        corresponde: packCorresponde(r["Pack"])
      }))
      .filter(p => p.rut && p.corresponde);

    const totalPacks = packs.length; // esto es el “6000 aprox”

    // 2) Log 2026: set de ruts entregados
    const store = getStore();
    const logText = (await store.get(LOG_KEY, { type: "text" })) || "";
    const logRows = parseCsv(logText, ",");
    const entregadosSet = new Set();

    if (logRows.length >= 2) {
      const h = logRows[0].map(x => x.trim());
      const iRut = h.indexOf("rut");
      if (iRut !== -1) {
        for (let i = 1; i < logRows.length; i++) {
          const rut = normalizeRut(logRows[i][iRut] || "");
          if (rut) entregadosSet.add(rut);
        }
      }
    }

    const totalEntregados = packs.reduce((acc, p) => acc + (entregadosSet.has(p.rut) ? 1 : 0), 0);
    const pctTotal = totalPacks ? (totalEntregados / totalPacks) : 0;

    // 3) Por categoría (solo packs)
    const catAgg = {};
    for (const p of packs) {
      const c = p.categoria || "SIN_CATEGORIA";
      catAgg[c] ||= { base: 0, entregados: 0 };
      catAgg[c].base++;
      if (entregadosSet.has(p.rut)) catAgg[c].entregados++;
    }
    const porCategoria = Object.entries(catAgg)
      .map(([categoria, v]) => ({ categoria, base: v.base, entregados: v.entregados, pct: v.base ? v.entregados / v.base : 0 }))
      .sort((a,b) => b.base - a.base);

    // 4) Por ubicación macro (PRIETO/LEPE/FOUILLIOUX/LIVINGSTONE/PREMIUM SEAT)
    const ubAgg = {};
    for (const p of packs) {
      const u = p.ubicacion || "";
      if (!u) continue;
      ubAgg[u] ||= { ubicacion: u, base: 0, entregados: 0 };
      ubAgg[u].base++;
      if (entregadosSet.has(p.rut)) ubAgg[u].entregados++;
    }
    const porUbicacion = Object.values(ubAgg)
      .map(v => ({ ...v, pct: v.base ? v.entregados / v.base : 0 }))
      .sort((a,b) => b.base - a.base);

    return json(200, {
      status: "OK",
      // IMPORTANTE: total_base ahora es “packs a entregar”
      total_abonados: totalAbonados,
      total_base: totalPacks,
      total_entregados: totalEntregados,
      pct_total: pctTotal,
      por_categoria: porCategoria,
      por_ubicacion: porUbicacion,
      updated_at: new Date().toISOString()
    });

  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
