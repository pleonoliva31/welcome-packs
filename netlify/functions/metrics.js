// netlify/functions/metrics.js
const { json, okCors, normalizeRut } = require("./_log_utils");
const blobs = require("@netlify/blobs");

const STORE_NAME = "welcome-packs";
const LOG_KEY = "registro_entregas.csv";

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Faltan BLOBS_SITE_ID / BLOBS_TOKEN");

  if (typeof blobs.getStore === "function") return blobs.getStore({ name: STORE_NAME, siteID, token });
  if (typeof blobs.createClient === "function") return blobs.createClient({ siteID, token }).getStore(STORE_NAME);

  throw new Error("No se pudo inicializar @netlify/blobs (sin getStore/createClient).");
}

// CSV parser simple pero soporta comillas
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

// ✅ Macro tribuna: LEPE / FOUILLIOUX / LIVINGSTONE / PRIETO (sin alto/bajo/medio)
function macroTribuna(t) {
  const s = String(t || "").trim().toUpperCase();
  if (!s) return "SIN_TRIBUNA";
  return s.split(/\s+/)[0]; // primera palabra
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();
    if (event.httpMethod !== "GET") return json(405, { status: "ERROR", error: "Method not allowed" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    // 1) Base (packs totales)
    const baseCsv = await loadText(baseUrl);
    const baseRows = parseCsv(baseCsv, ";");
    if (baseRows.length < 2) return json(200, { status: "OK", total_base: 0, total_entregados: 0, pct_total: 0, por_categoria: [], por_ubicacion: [] });

    const baseHeaders = baseRows[0];
    const baseData = baseRows.slice(1);

    const idxRut = baseHeaders.indexOf("Rut");
    const idxCat = baseHeaders.indexOf("Welcome Pack");
    const idxTrib = baseHeaders.indexOf("Tribuna");

    if (idxRut === -1) throw new Error("Base CSV sin columna 'Rut'.");

    const packsBase = baseData.map(r => ({
      rut: normalizeRut(r[idxRut] || ""),
      categoria: String(r[idxCat] || "").trim().toUpperCase(),
      tribuna: String(r[idxTrib] || "").trim()
    })).filter(p => p.rut);

    const totalBase = packsBase.length;

    // 2) Log (packs entregados) — tomamos columna "rut"
    const store = getStore();
    const logText = (await store.get(LOG_KEY, { type: "text" })) || "";
    const logRows = parseCsv(logText, ",");
    const entregadosSet = new Set();

    if (logRows.length >= 2) {
      const h = logRows[0].map(x => x.trim());
      const iRutLog = h.indexOf("rut");
      if (iRutLog !== -1) {
        for (let i = 1; i < logRows.length; i++) {
          const rut = normalizeRut(logRows[i][iRutLog] || "");
          if (rut) entregadosSet.add(rut);
        }
      }
    }

    const totalEntregados = packsBase.reduce((acc, p) => acc + (entregadosSet.has(p.rut) ? 1 : 0), 0);
    const pctTotal = totalBase ? (totalEntregados / totalBase) : 0;

    // 3) % por categoría (pack)
    const catAgg = {}; // {CAT: {base, entregados}}
    for (const p of packsBase) {
      const c = p.categoria || "SIN_CATEGORIA";
      catAgg[c] ||= { base: 0, entregados: 0 };
      catAgg[c].base++;
      if (entregadosSet.has(p.rut)) catAgg[c].entregados++;
    }

    const porCategoria = Object.entries(catAgg)
      .map(([categoria, v]) => ({
        categoria,
        base: v.base,
        entregados: v.entregados,
        pct: v.base ? v.entregados / v.base : 0
      }))
      .sort((a,b) => b.base - a.base);

    // 4) ✅ % por UBICACIÓN (macro tribuna)
    const ubAgg = {}; // {UBICACION:{ubicacion, base, entregados}}
    for (const p of packsBase) {
      const ubicacion = macroTribuna(p.tribuna);
      ubAgg[ubicacion] ||= { ubicacion, base: 0, entregados: 0 };
      ubAgg[ubicacion].base++;
      if (entregadosSet.has(p.rut)) ubAgg[ubicacion].entregados++;
    }

    const porUbicacion = Object.values(ubAgg)
      .map(v => ({ ...v, pct: v.base ? v.entregados / v.base : 0 }))
      .sort((a,b) => b.base - a.base);

    return json(200, {
      status: "OK",
      total_base: totalBase,
      total_entregados: totalEntregados,
      pct_total: pctTotal,
      por_categoria: porCategoria,
      por_ubicacion: porUbicacion,
      updated_at: new Date().toISOString(),
    });

  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
