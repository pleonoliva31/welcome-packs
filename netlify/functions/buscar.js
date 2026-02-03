// netlify/functions/buscar.js
import {
  json,
  normalizeRut,
  fetchCsvText,
  parseCsvSemicolon,
  getStores,
} from "./_log_utils.js";

function pick(obj, key) {
  return obj?.[key] ?? "";
}

function groupKeyFromRow(row) {
  const rutComprador = normalizeRut(pick(row, "Rut Comprador"));
  const rut = normalizeRut(pick(row, "Rut"));
  return rutComprador || rut;
}

function mapRow(row) {
  return {
    rut: normalizeRut(pick(row, "Rut")),
    nombre: pick(row, "Nombre Completo") || pick(row, "Nombre"),
    categoria: pick(row, "Welcome Pack") || pick(row, "Categoría"),
    tribuna: pick(row, "Tribuna"),
    sector: pick(row, "Sector"),
    rut_comprador: normalizeRut(pick(row, "Rut Comprador")),
    nombre_comprador: pick(row, "Nombre Comprador"),
  };
}

export const handler = async (event) => {
  try {
    const rutQuery = normalizeRut(event.queryStringParameters?.rut || "");
    if (!rutQuery) return json(400, { status: "ERROR", error: "Falta rut" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(200, { status: "NO_BASE" });

    const csvText = await fetchCsvText(baseUrl);
    const { rows } = parseCsvSemicolon(csvText);

    const mapped = rows.map(mapRow);

    const matches = mapped.filter((r) => r.rut === rutQuery || r.rut_comprador === rutQuery);
    if (!matches.length) return json(200, { status: "NO_ENCONTRADO" });

    const groupKey = groupKeyFromRow(matches[0]);
    const groupRows = mapped.filter((r) => groupKeyFromRow(r) === groupKey);

    const { logStore } = await getStores();
    const logRaw = (await logStore.get("log.json"))?.toString?.() || "";
    const log = logRaw ? JSON.parse(logRaw) : [];

    const yaEntregado = log.some((x) => String(x.group_key || "") === groupKey);

    const resumenMap = {};
    for (const r of groupRows) {
      const cat = (r.categoria || "SIN_CATEGORIA").toUpperCase();
      resumenMap[cat] = (resumenMap[cat] || 0) + 1;
    }
    const resumen = Object.entries(resumenMap).map(([k, v]) => `${v} - ${k}`);

    const compradorRow = groupRows.find((r) => r.rut_comprador) || groupRows[0];

    return json(200, {
      status: yaEntregado ? "YA_ENTREGADO" : "PENDIENTE",
      grupo: {
        rut_comprador: compradorRow.rut_comprador || groupKey,
        nombre_comprador: compradorRow.nombre_comprador || "",
      },
      miembros: groupRows.map((r) => ({
        rut: r.rut,
        nombre: r.nombre,
        categoria: r.categoria,
        tribuna: r.tribuna,
        sector: r.sector,
      })),
      resumen,
    });
  } catch (e) {
    return json(200, { status: "ERROR", error: String(e?.message || e) });
  }
};
