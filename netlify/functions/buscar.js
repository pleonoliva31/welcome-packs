// netlify/functions/buscar.js
const { json, normalizeRut } = require("./_log_utils");

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar CSV. HTTP ${res.status}`);
  return await res.text();
}

function parseCsvSemicolon(csvText) {
  // Tu CSV es separado por ; (según tus capturas)
  // OJO: aquí asumimos que no hay ; dentro de campos.
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(";").map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (cols[idx] ?? "").trim()));
    rows.push(obj);
  }
  return { headers, rows };
}

function mapRow(r) {
  // Mapeo desde tus headers reales del CSV (con espacios/mayúsculas)
  return {
    rut_comprador: r["Rut Comprador"] || "",
    nombre_comprador: r["Nombre Comprador"] || "",
    email_comprador: r["Email Comprador"] || "",
    rut: r["Rut"] || "",
    nombre: r["Nombre Completo"] || "",
    categoria: r["Welcome Pack"] || "",
    tribuna: r["Tribuna"] || "",
    sector: r["Sector"] || "",
    entregado: r["Entregado"] || "", // puede venir vacío
  };
}

exports.handler = async (event) => {
  try {
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const rutQuery = event.queryStringParameters?.rut || "";
    const rutN = normalizeRut(rutQuery);
    if (!rutN) return json(400, { status: "ERROR", error: "Falta rut" });

    const csv = await loadCsv(baseUrl);
    const { rows } = parseCsvSemicolon(csv);

    const mapped = rows.map(mapRow);

    // Buscar coincidencia por rut (normalizado)
    const match = mapped.find((x) => normalizeRut(x.rut) === rutN);
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    // Grupo = todos los que comparten rut_comprador (normalizado)
    const rutCompradorN = normalizeRut(match.rut_comprador);
    const grupo = mapped.filter((x) => normalizeRut(x.rut_comprador) === rutCompradorN);

    const miembros = grupo.map((m) => ({
      rut: normalizeRut(m.rut),
      nombre: m.nombre,
      categoria: m.categoria,
      tribuna: m.tribuna,
      sector: m.sector,
    }));

    // Estado del grupo: si alguno tiene entregado marcado (o si tu lógica es “grupo completo entregado”)
    // Mantengo criterio: si hay AL MENOS 1 entregado => YA_ENTREGADO (puedes ajustar)
    const hayEntregado = grupo.some((m) => String(m.entregado || "").trim() !== "");
    const estado = hayEntregado ? "YA_ENTREGADO" : "PENDIENTE";

    // resumen por categoría
    const conteo = {};
    grupo.forEach((m) => {
      const c = (m.categoria || "SIN_CATEGORIA").trim().toUpperCase();
      conteo[c] = (conteo[c] || 0) + 1;
    });
    const resumen = Object.entries(conteo).map(([cat, n]) => `${n} - ${cat}`);

    return json(200, {
      status: estado,
      buscado: { rut: normalizeRut(match.rut), nombre: match.nombre },
      comprador: { rut: normalizeRut(match.rut_comprador), nombre: match.nombre_comprador },
      miembros,
      resumen,
    });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
