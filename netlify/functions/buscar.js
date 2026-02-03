// netlify/functions/buscar.js
const {
  json,
  okCors,
  normalizeRut,
  parseCsvSemicolon,
  mapRowFromCsv,
  groupKeyFromRow,
  summarizeByCategory,
} = require("./_log_utils");

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar CSV. HTTP ${res.status}`);
  return await res.text();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();

  try {
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const rutQuery = event.queryStringParameters?.rut || "";
    const rutN = normalizeRut(rutQuery);
    if (!rutN) return json(400, { status: "ERROR", error: "Falta rut" });

    const csv = await loadCsv(baseUrl);
    const { rows } = parseCsvSemicolon(csv);
    const mapped = rows.map(mapRowFromCsv);

    const match = mapped.find((x) => normalizeRut(x.rut) === rutN);
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    const groupKey = groupKeyFromRow(match);
    const grupo = mapped.filter((x) => groupKeyFromRow(x) === groupKey);

    // criterio estado: si cualquiera tiene Entregado no vacío => YA_ENTREGADO
    const hayEntregado = grupo.some((m) => String(m.entregado || "").trim() !== "");
    const status = hayEntregado ? "YA_ENTREGADO" : "PENDIENTE";

    const miembros = grupo.map((m) => ({
      rut: normalizeRut(m.rut),
      nombre: m.nombre,
      categoria: m.categoria,
      tribuna: m.tribuna,
      sector: m.sector,
      entregado: String(m.entregado || "").trim(), // si quieres mostrarlo
    }));

    const resumen = summarizeByCategory(grupo);

    return json(200, {
      status,
      buscado: { rut: normalizeRut(match.rut), nombre: match.nombre },
      comprador: { rut: normalizeRut(match.rut_comprador), nombre: match.nombre_comprador },
      miembros,
      resumen,
    });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
