// netlify/functions/entregar.js
const { json, normalizeRut, appendLog, readAllLogs } = require("./_log_utils");

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { status: "ERROR", error: "Use POST" });

    const body = JSON.parse(event.body || "{}");
    const rutBuscado = normalizeRut(body.rut_busqueda || body.rut || "");
    const rutReceptor = normalizeRut(body.rut_receptor || "");
    const nombreReceptor = String(body.nombre_receptor || "").trim();

    if (!rutBuscado) return json(400, { status: "ERROR", error: "Falta rut_busqueda" });
    if (!rutReceptor || !nombreReceptor) return json(400, { status: "ERROR", error: "Falta rut_receptor o nombre_receptor" });

    // Regla: receptor debe pertenecer al grupo → eso lo valida la UI con /buscar,
    // pero lo reforzamos aquí si mandas también miembros del grupo.
    const miembros = Array.isArray(body.miembros) ? body.miembros : [];
    if (miembros.length) {
      const ok = miembros.some((m) => normalizeRut(m.rut) === rutReceptor);
      if (!ok) {
        return json(200, {
          status: "ERROR_RECEPTOR",
          error: "El RUT ingresado no corresponde a este abono",
        });
      }
    }

    // Evitar doble entrega: revisamos logs previos por rut_busqueda
    const logs = await readAllLogs(5000);
    const ya = logs.find((l) => normalizeRut(l.rut_busqueda) === rutBuscado);
    if (ya) {
      return json(200, { status: "YA_ENTREGADO", existente: ya });
    }

    const entry = {
      ts: Date.now(),
      rut_busqueda: rutBuscado,
      rut_receptor: rutReceptor,
      nombre_receptor: nombreReceptor,
      // opcional: info de resumen/categorías para la tabla admin
      comprador_rut: normalizeRut(body.comprador_rut || ""),
      comprador_nombre: String(body.comprador_nombre || "").trim(),
      detalle_categorias: body.detalle_categorias || null,
    };

    await appendLog(entry);
    return json(200, { status: "OK", saved: entry });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
