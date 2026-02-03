// netlify/functions/entregar.js
const { createClient } = require("@netlify/blobs");
const { json, normalizeRut } = require("./_log_utils");

function nowIso() {
  return new Date().toISOString();
}

function ensureEnv() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) {
    throw new Error("Faltan BLOBS_SITE_ID o BLOBS_TOKEN en variables de entorno.");
  }
  return { siteID, token };
}

function parseCsv(csvText) {
  const lines = (csvText || "").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(",").map(s => s.trim());
  const rows = lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    header.forEach((h, i) => obj[h] = (cols[i] ?? "").trim());
    return obj;
  });
  return { header, rows };
}

function toCsv(header, rows) {
  const head = header.join(",");
  const body = rows.map(r => header.map(h => (r[h] ?? "")).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { status: "ERROR", error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");

    const rut_buscado = normalizeRut(body.rut_buscado || body.rut_busqueda || "");
    const rut_receptor = normalizeRut(body.rut_receptor || "");
    const nombre_receptor = String(body.nombre_receptor || "").trim();

    if (!rut_buscado) return json(400, { status: "ERROR", error: "Falta rut_buscado" });
    if (!rut_receptor) return json(400, { status: "ERROR", error: "Falta rut_receptor" });
    if (!nombre_receptor) return json(400, { status: "ERROR", error: "Falta nombre_receptor" });

    // ✅ Blobs client manual (evita el error que estás viendo)
    const { siteID, token } = ensureEnv();
    const client = createClient({ siteID, token });

    // Store y archivo (según tu Netlify > Blobs)
    const store = client.getStore("welcome-packs");
    const key = "registro_entregas.csv";

    // 1) leer CSV actual (si no existe, partimos vacío)
    let csvText = "";
    try {
      csvText = await store.get(key, { type: "text" });
    } catch (_) {
      csvText = "";
    }

    const header = ["fecha_iso", "rut_buscado", "rut_receptor", "nombre_receptor"];
    const parsed = parseCsv(csvText);

    // Si el archivo existe pero tiene otro header, lo dejamos como está si es compatible
    const effectiveHeader =
      parsed.header && parsed.header.length >= header.length
        ? parsed.header
        : header;

    const rows = parsed.rows || [];

    // 2) evitar duplicado exacto (mismo rut_buscado ya registrado)
    const yaExiste = rows.some(r => normalizeRut(r.rut_buscado) === rut_buscado);
    if (yaExiste) {
      return json(409, { status: "YA_ENTREGADO", error: "Este RUT ya tiene entrega registrada." });
    }

    // 3) agregar registro
    rows.push({
      fecha_iso: nowIso(),
      rut_buscado,
      rut_receptor,
      nombre_receptor
    });

    const outCsv = toCsv(effectiveHeader, rows);

    // 4) guardar en Blobs
    await store.set(key, outCsv, { contentType: "text/csv" });

    return json(200, { status: "OK" });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
