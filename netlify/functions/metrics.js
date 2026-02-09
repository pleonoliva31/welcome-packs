// netlify/functions/metrics.js
const { json, okCors, normalizeRut, stripDiacritics } = require("./_log_utils");
const blobs = require("@netlify/blobs");

const STORE_NAME = "welcome-packs";
const LOG_KEY = "registro_entregas_2026.csv"; // ✅ log 2026

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
      rows.push(row.map(x => String(x ?? "").trim()));
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row.map(x => String(x ?? "").trim()));
  }

  return rows.filter(r => r.some(c => String(c || "").trim() !== ""));
}

async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar base. HTTP ${res.status}`);
  return await res.text();
}

function normPack(v) {
  return stripDiacritics(String(v || "")).trim().toUpperCase();
}
function packCorresponde(packRaw) {
  const p = normPack(packRaw);
  return p === "SI" || p === "PREMIUM SEAT";
}

function ubicacionDesdeSector(packRaw, sectorRaw) {
  const p = normPack(packRaw);
  if (p === "PREMIUM SEAT") return "PREMIUM SEAT";

  const s = stripDiacritics(String(sectorRaw || "")).toUpperCase();
  if (s.includes("PRIETO")) return "PRIETO";
  if (s.includes("LEPE")) return "LEPE";
  if (s.includes("FOUILLIOUX")) return "FOUILLIOUX";
  if (s.includes("LIVINGSTONE")) return "LIVINGSTONE";
  return "OTROS";
}

// ✅ hora Chile (sin Z)
function nowChileString() {
  const dtf = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  // es-CL suele venir como "05-02-2026, 12:49:00" → lo dejamos legible
  return dtf.format(new Date()).replace(",", "");
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();
    if (event.httpMethod !== "GET") return json(405, { status: "ERROR", error: "Method not allowed" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    // 1) Base
    const baseCsv = await loadText(baseUrl);
    const baseRows = parseCsv(baseCsv, ";");
    if (baseRows.length < 2) {
      return json(200, {
        status: "OK",
        total_base: 0,
        total_entregados: 0,
        pct_total: 0,
        por_categoria: [],
        por_ubicacion: [],
        invalid_rut_con_pack: 0,
        updated_at: nowChileString(),
        updated_at_iso: new Date().toISOString(),
      });
    }

    const headers = baseRows[0].map(h => String(h || "").trim());
    const data = baseRows.slice(1);

    const idxRut = headers.findIndex(h => h.toLowerCase() === "rut");
    const idxCat = headers.findIndex(h => h.toLowerCase() === "categoria");
    const idxSector = headers.findIndex(h => h.toLowerCase() === "sector");
    const idxPack = headers.findIndex(h => h.toLowerCase() === "pack");

    if (idxRut === -1) throw new Error("Base CSV sin columna 'Rut'.");
    if (idxPack === -1) throw new Error("Base CSV sin columna 'Pack'.");
    if (idxCat === -1) throw new Error("Base CSV sin columna 'Categoria'.");
    if (idxSector === -1) throw new Error("Base CSV sin columna 'Sector'.");

    // ✅ Solo filas con pack, pero NO botamos si normalizeRut falla.
    const packsBase = data
      .map(r => {
        const rutRaw = String(r[idxRut] || "").trim();
        const rutN = normalizeRut(rutRaw || "");
        return {
          rut_raw: rutRaw,
          rut: rutN, // puede quedar ""
          categoria: String(r[idxCat] || "").trim().toUpperCase(),
          sector: String(r[idxSector] || "").trim(),
          pack: String(r[idxPack] || "").trim(),
        };
      })
      .filter(p => packCorresponde(p.pack));

    const totalBase = packsBase.length;
    const invalidRutConPack = packsBase.reduce((acc, p) => acc + (!p.rut ? 1 : 0), 0);

    // 2) Log (entregados)
    const store = getStore();
    const logText = (await store.get(LOG_KEY, { type: "text" })) || "";
    const logRows = parseCsv(logText, ",");
    const entregadosSet = new Set();

    if (logRows.length >= 2) {
      const h = logRows[0].map(x => String(x || "").trim().toLowerCase());
      const iRut = h.indexOf("rut");
      if (iRut !== -1) {
        for (let i = 1; i < logRows.length; i++) {
          const rut = normalizeRut(logRows[i][iRut] || "");
          if (rut) entregadosSet.add(rut);
        }
      }
    }

    const totalEntregados = packsBase.reduce((acc, p) => acc + (p.rut && entregadosSet.has(p.rut) ? 1 : 0), 0);
    const pctTotal = totalBase ? (totalEntregados / totalBase) : 0;

    // 3) Por “categoría de pack” (PREMIUM vs PREMIUM SEAT)
const catAgg = {};
for (const p of packsBase) {
  // Si el pack es PREMIUM SEAT lo separamos; si no, cae en PREMIUM
  const packKey = normPack(p.pack) === "PREMIUM SEAT" ? "PREMIUM SEAT" : "PREMIUM";

  catAgg[packKey] ||= { base: 0, entregados: 0 };
  catAgg[packKey].base++;
  if (entregadosSet.has(p.rut)) catAgg[packKey].entregados++;
}

    const porCategoria = Object.entries(catAgg)
      .map(([categoria, v]) => ({
        categoria,
        base: v.base,
        entregados: v.entregados,
        pct: v.base ? v.entregados / v.base : 0
      }))
      .sort((a,b) => b.base - a.base);

    // 4) Por ubicación
    const uAgg = {};
    for (const p of packsBase) {
      const ubicacion = ubicacionDesdeSector(p.pack, p.sector);
      uAgg[ubicacion] ||= { ubicacion, base: 0, entregados: 0 };
      uAgg[ubicacion].base++;
      if (p.rut && entregadosSet.has(p.rut)) uAgg[ubicacion].entregados++;
    }

    const porUbicacion = Object.values(uAgg)
      .map(v => ({ ...v, pct: v.base ? v.entregados / v.base : 0 }))
      .sort((a,b) => b.base - a.base);

    return json(200, {
      status: "OK",
      total_base: totalBase,
      total_entregados: totalEntregados,
      pct_total: pctTotal,
      por_categoria: porCategoria,
      por_ubicacion: porUbicacion,
      invalid_rut_con_pack: invalidRutConPack, // ✅ para validar esos 34
      updated_at: nowChileString(),           // ✅ hora Chile (sin Z)
      updated_at_iso: new Date().toISOString()// (debug)
    });

  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
