// netlify/functions/entregar.js
const { json, normalizeRut, nowIso } = require("./_log_utils");
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { status: "ERROR", error: "Método no permitido" });

    const body = JSON.parse(event.body || "{}");

    const rutBuscado = normalizeRut(body.rut_busqueda || "");
    const rutReceptor = normalizeRut(body.rut_receptor || "");
    const nombreReceptor = String(body.nombre_receptor || "").trim();

    if (!rutBuscado) return json(400, { status: "ERROR", error: "Falta rut_busqueda" });
    if (!rutReceptor) return json(400, { status: "ERROR", error: "Falta rut_receptor" });
    if (!nombreReceptor) return json(400, { status: "ERROR", error: "Falta nombre_receptor" });

    // volvemos a buscar para obtener el comprador/grupo
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const res = await fetch(`${process.env.URL || ""}/.netlify/functions/buscar?rut=${encodeURIComponent(rutBuscado)}`);
    if (!res.ok) return json(500, { status: "ERROR", error: `Fallo buscar interno: HTTP ${res.status}` });

    const data = await res.json();
    if (data.status === "NO_ENCONTRADO") return json(404, { status: "NO_ENCONTRADO" });

    // Si ya entregado, no permitir duplicar
    if (data.status === "YA_ENTREGADO") {
      return json(409, { status: "YA_ENTREGADO", entrega: data.entrega || null });
    }

    const rutComprador = normalizeRut(data.comprador?.rut || "");
    if (!rutComprador) return json(500, { status: "ERROR", error: "No pude determinar rut comprador/grupo" });

    const store = getStore("welcomepack");

    const keyGrupo = `entrega_grupo_${rutComprador}`;
    const keyLog = `log_${Date.now()}_${rutComprador}`;

    const payload = {
      fecha_iso: nowIso(),
      rut_comprador: rutComprador,
      nombre_comprador: data.comprador?.nombre || "",
      rut_busqueda: rutBuscado,
      nombre_busqueda: data.buscado?.nombre || "",
      rut_receptor: rutReceptor,
      nombre_receptor: nombreReceptor,
      resumen: data.resumen || [],
      miembros: data.miembros || [],
    };

    // Guarda registro "único por grupo"
    await store.setJSON(keyGrupo, payload);

    // Guarda un log histórico (por si después quieres exportar)
    await store.setJSON(keyLog, payload);

    return json(200, { status: "OK", entrega: payload });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
