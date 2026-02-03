// netlify/functions/export_log.js
const { okCors } = require("./_log_utils");
const { createClient } = require("@netlify/blobs");

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Falta BLOBS_SITE_ID o BLOBS_TOKEN.");
  const client = createClient({ siteID, token });
  return client.getStore("welcome-pack-logs");
}

function toCsv(rows) {
  const headers = [
    "rut_comprador",
    "rut_receptor",
    "nombre_receptor",
    "rut_buscado",
    "nombre_buscado",
    "resumen",
    "created_at",
    "updated_at",
  ];
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];

  for (const r of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = h === "resumen" ? (Array.isArray(r.resumen) ? r.resumen.join(" | ") : "") : r[h];
          return escape(v);
        })
        .join(",")
    );
  }
  return lines.join("\n");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();

  try {
    const store = getStore();
    const all = [];
    let cursor = undefined;

    while (true) {
      const res = await store.list({ cursor, limit: 200 });
      for (const b of res.blobs) {
        const raw = await store.get(b.key);
        if (!raw) continue;
        all.push(JSON.parse(raw));
      }
      if (!res.next_cursor) break;
      cursor = res.next_cursor;
    }

    all.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

    const csv = toCsv(all);
    return {
      statusCode: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="entregas_log.csv"',
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
      body: csv,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" },
      body: String(e?.message || e),
    };
  }
};
