// netlify/functions/entregar.js
const { json, okCors, normalizeRut } = require("./_log_utils");
const { createClient } = require("@netlify/blobs");

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) {
    throw new Error(
      "Netlify Blobs no configurado. Falta BLOBS_SITE_ID o BLOBS_TOKEN."
    );
  }
  const client = createClient({ siteID, token });
  return client.getStore("welcome-pack-logs"); // nombre del store
}

function nowIso() {
  return new Date().toISOString();
}

// clave por grupo: rut_comprador normalizado
function groupKey(rutComprador) {
  return normalizeRut(rutComprador);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();
  if (event.httpMethod !== "POST") return json(405, { status: "ERROR", error: "Usa POST" });

  try {
    const body = JSON.parse(event.body || "{}");

    // datos mínimos
    const rutComprador = normalizeRut(body.rut_comprador || "");
    const rutReceptor = normalizeRut(body.rut_receptor || "");
    const nombreReceptor = String(body.nombre_receptor || "").trim();

    // opcional: para auditoría
    const rutBuscado = normalizeRut(body.rut_buscado || "");
    const nombreBuscado = String(body.nombre_buscado || "").trim();

    // detalle del grupo (miembros y resumen) opcional pero recomendado para snapshot
    const miembros = Array.isArray(body.miembros) ? body.miembros : [];
    const resumen = Array.isArray(body.resumen) ? body.resumen : [];

    if (!rutComprador) return json(400, { status: "ERROR", error: "Falta rut_comprador" });
    if (!rutReceptor) return json(400, { status: "ERROR", error: "Falta rut_receptor" });
    if (!nombreReceptor) return json(400, { status: "ERROR", error: "Falta nombre_receptor" });

    const store = getStore();
    const key = groupKey(rutComprador);

    // leer estado actual del grupo
    const existingRaw = await store.get(key);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;

    // Si ya entregado, no permitir doble
    if (existing?.entregado === true) {
      return json(200, {
        status: "YA_ENTREGADO",
        message: "Este grupo ya registra entrega.",
        registro: existing,
      });
    }

    const registro = {
      rut_comprador: rutComprador,
      rut_receptor: rutReceptor,
      nombre_receptor: nombreReceptor,
      rut_buscado: rutBuscado,
      nombre_buscado: nombreBuscado,
      miembros,
      resumen,
      entregado: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await store.set(key, JSON.stringify(registro));

    return json(200, { status: "OK", registro });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
