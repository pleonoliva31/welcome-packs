// netlify/functions/entregar.js
const { getStore } = require("@netlify/blobs");
const { json, normalizeRut, nowISO } = require("./_log_utils");

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

async function readBlobText(store) {
  const blob = await store.get(KEY, { type: "text" });
  return blob || "";
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

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { status: "ERROR", error: "Body JSON inválido" }); }

    const rut_buscado = normalizeRut(body.rut_buscado || body.rut_busqueda || "");
    const rut_receptor = normalizeRut(body.rut_receptor || "");
    const nombre_receptor = String(body.nombre_receptor || "").trim();

    if (!rut_buscado) return json(400, { status: "ERROR", error: "Falta rut_buscado" });
    if (!rut_receptor) return json(400, { status: "ERROR", error: "Falta rut_receptor" });
    if (!nombre_receptor) return json(400, { status: "ERROR", error: "Falta nombre_receptor" });

    // ✅ FORZADO con credenciales
    const store = getStore(STORE_NAME, { siteID, token });

    const existing = await readBlobText(store);
    const lines = existing.split(/\r?\n/).filter(Boolean);

    const hasHeader = lines[0]?.toLowerCase().includes("rut_buscado");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const yaExiste = dataLines.some((ln) => {
      const cols = ln.split(",");
      const rb = normalizeRut(cols[0] || "");
      return rb === rut_buscado;
    });

    if (yaExiste) return json(409, { status: "YA_ENTREGADO" });

    const fecha_iso = nowISO();

    let out = existing;
    if (!out.trim()) out = "rut_buscado,rut_receptor,nombre_receptor,fecha_iso\n";
    else if (!out.endsWith("\n")) out += "\n";

    out += toCsvLine([rut_buscado, rut_receptor, nombre_receptor, fecha_iso]);

    await store.set(KEY, out, { contentType: "text/csv; charset=utf-8" });

    return json(200, { status: "OK", fecha_iso });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
