// netlify/functions/export_pendientes.js
import { getStore } from "@netlify/blobs";

// --- Utilidades CSV ---
const toCSV = (rows) => {
  if (!rows || !rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) =>
    `"${String(v ?? "")
      .replace(/"/g, '""')
      .replace(/\r?\n/g, " ")
      .trim()}"`;
  const head = headers.map(esc).join(";");
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(";")).join("\n");
  return head + "\n" + body;
};

// Normaliza headers del CSV (minúscula, sin espacios/acentos)
const normHeader = (h) =>
  String(h || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");

// Parseo simple CSV con separador ; (como tu base)
function parseCSVSemicolon(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const rawHeaders = lines[0].split(";").map((s) => s.trim());
  const headers = rawHeaders.map(normHeader);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";"); // simple: sin comillas escapadas
    const row = {};
    headers.forEach((h, idx) => (row[h] = (cols[idx] ?? "").trim()));
    rows.push(row);
  }
  return rows;
}

// Lee el log desde Blobs (JSONL/NDJSON/JSON)
async function readLog() {
  const storeName = process.env.BLOBS_STORE || "entregas";
  const store = getStore(storeName);
  const candidateKeys = [
    "entregas_log.jsonl",
    "entregas_log.ndjson",
    "registro_entregas.jsonl",
    "log.jsonl",
    "entregas_log.json",
    "registro_entregas.json",
  ];

  for (const key of candidateKeys) {
    try {
      const text = await store.get(key, { type: "text" });
      if (!text) continue;

      // JSON lineado
      if (key.endsWith(".jsonl") || key.endsWith(".ndjson")) {
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const rows = lines.map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        if (rows.length) return rows;
      }

      // Arreglo JSON
      if (key.endsWith(".json")) {
        try {
          const arr = JSON.parse(text);
          if (Array.isArray(arr) && arr.length) return arr;
        } catch {}
      }
    } catch {
      // sigue probando otras keys
    }
  }
  return [];
}

// Extrae campos que usaremos (independiente del nombre exacto del CSV)
function mapBaseRow(r) {
  // Probables nombres en tu base (según tus ejemplos)
  const rutComprador = r.rut_comprador || r.rutcomprador || r["rut comprador"] || r.comprador || r.compra_rut || "";
  const nomComprador = r.nombre_comprador || r.nombrecomprador || r["nombre comprador"] || "";
  const rut = r.rut || r["rut"] || r.rut_abonado || "";
  const nombre = r.nombre_completo || r.nombre || r["nombre completo"] || "";
  const categoria = r.categoria || r["welcome_pack"] || r.welcome_pack || r["welcome pack"] || "";
  const tribuna = r.tribuna || "";
  const sector = r.sector || "";

  return {
    rut_comprador: String(rutComprador).toUpperCase().replace(/[.\-]/g, "").trim(),
    nombre_comprador: String(nomComprador || "").trim(),
    rut: String(rut).toUpperCase().replace(/[.\-]/g, "").trim(),
    nombre: String(nombre || "").trim(),
    categoria: String(categoria || "").trim(),
    tribuna: String(tribuna || "").trim(),
    sector: String(sector || "").trim(),
  };
}

function mapLogRow(r) {
  return {
    rut_comprador: String(r?.rut_comprador || r?.comprador_rut || "").toUpperCase().replace(/[.\-]/g, "").trim(),
    // otros campos no son necesarios para la resta, pero podrían servir
  };
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") || "grupos").toLowerCase(); // "grupos" | "personas"
    const format = (url.searchParams.get("format") || "csv").toLowerCase();  // "csv" | "json"

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) {
      return new Response(JSON.stringify({ ok: false, error: "Falta BASE_CSV_URL" }),
        { status: 500, headers: { "content-type": "application/json" } });
    }

    // 1) Base
    const baseRes = await fetch(baseUrl, { cache: "no-store" });
    if (!baseRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: `No se pudo leer BASE_CSV_URL (HTTP ${baseRes.status})` }),
        { status: 500, headers: { "content-type": "application/json" } });
    }
    const baseText = await baseRes.text();
    const baseRowsRaw = parseCSVSemicolon(baseText);
    const baseRows = baseRowsRaw.map(mapBaseRow).filter(r => r.rut && r.rut_comprador);

    // 2) Log entregas
    const logRows = (await readLog()).map(mapLogRow).filter(r => r.rut_comprador);

    // Set de compradores que ya retiraron (entrega total por regla del negocio)
    const entregadosSet = new Set(logRows.map(r => r.rut_comprador));

    // Agrupamos base por rut_comprador
    const grupos = new Map(); // rut_comprador -> { nombre_comprador, tribuna, sector, miembros: [] }
    for (const r of baseRows) {
      const g = grupos.get(r.rut_comprador) || {
        rut_comprador: r.rut_comprador,
        nombre_comprador: r.nombre_comprador,
        tribuna: r.tribuna,
        sector: r.sector,
        miembros: [],
      };
      g.miembros.push({ rut: r.rut, nombre: r.nombre, categoria: r.categoria, tribuna: r.tribuna, sector: r.sector });
      grupos.set(r.rut_comprador, g);
    }

    // Filtramos pendientes: grupos cuyo rut_comprador NO está en entregadosSet
    const pendientesGrupos = [...grupos.values()].filter(g => !entregadosSet.has(g.rut_comprador));

    // Salidas
    if (scope === "grupos") {
      const out = pendientesGrupos.map(g => ({
        rut_comprador: g.rut_comprador,
        nombre_comprador: g.nombre_comprador,
        tribuna: g.tribuna,
        sector: g.sector,
        total_personas: g.miembros.length,
        detalle_categorias: resumenCategorias(g.miembros), // ej: "3 ESTANDAR; 1 NIÑO"
      }));
      if (format === "json") {
        return new Response(JSON.stringify({ ok: true, scope, rows: out }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
      }
      return new Response(toCSV(out), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="pendientes_grupos.csv"',
        },
      });
    }

    // scope === "personas"
    const outP = pendientesGrupos.flatMap(g =>
      g.miembros.map(m => ({
        rut: m.rut,
        nombre: m.nombre,
        categoria: m.categoria,
        rut_comprador: g.rut_comprador,
        nombre_comprador: g.nombre_comprador,
        tribuna: m.tribuna || g.tribuna,
        sector: m.sector || g.sector,
      }))
    );

    if (format === "json") {
      return new Response(JSON.stringify({ ok: true, scope, rows: outP }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    return new Response(toCSV(outP), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="pendientes_personas.csv"',
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || "Error interno" }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
  }
};

function resumenCategorias(miembros) {
  const map = new Map();
  for (const m of miembros) {
    const k = (m.categoria || "SIN_CATEGORIA").toString().toUpperCase().trim();
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].map(([k, n]) => `${n} ${k}`).join("; ");
}
