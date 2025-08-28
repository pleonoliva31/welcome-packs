// netlify/functions/export_log.js
import { getLog } from "./_log_utils.js";

const HEADERS = [
  "fecha_hora",          // ts
  "rut_receptor",
  "nombre_receptor",
  "rut_comprador",
  "nombre_comprador",
  "total_packs",
  "detalle_categorias",  // "3 ESTÁNDAR · 1 NIÑO", etc.
  "tribuna",
  "sector"
];

// Excel-friendly: comas + BOM + escapar comillas
function csvEscape(v) {
  const s = String(v ?? "");
  const needQuotes = /[",\n]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needQuotes ? `"${esc}"` : esc;
}
function toCSV(rows) {
  const header = HEADERS.join(",");
  const body = rows.map(r => [
    r.ts || "",
    r.rut_receptor || "",
    r.nombre_receptor || "",
    r.rut_comprador || "",
    r.nombre_comprador || "",
    r.total_packs ?? "",
    r.detalle_texto ?? "",
    r.tribuna ?? "",
    r.sector ?? ""
  ].map(csvEscape).join(",")).join("\n");
  // BOM al inicio para que Excel abra con UTF-8
  return "\uFEFF" + header + "\n" + body;
}

export const handler = async (event) => {
  try {
    const fmt = (event.queryStringParameters?.format || "csv").toLowerCase();

    const rows = await getLog(); // <- lee log.json del blob "entregas_log"

    if (fmt === "json") {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="entregas_${stamp()}.json"`
        },
        body: JSON.stringify(rows, null, 2),
      };
    }

    const csv = toCSV(rows);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="entregas_${stamp()}.csv"`
      },
      body: csv
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(e) })
    };
  }
};

function stamp() {
  // 2025-08-23T20:18:30Z -> 20250823_201830
  const d = new Date().toISOString().replace(/[-:]/g,"").replace("T","_").slice(0,15);
  return d;
}
