// netlify/functions/buscar.js
import { getLog } from "./_log_utils.js";

export const handler = async (event) => {
  try {
    const q = normRut((event.queryStringParameters || {}).rut || "");
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json({ status: "NO_BASE" });

    const res = await fetch(baseUrl, { cache: "no-store" });
    if (!res.ok) return json({ status: "ERROR_CSV" }, 500);
    const csv = await res.text();
    const rows = parseBase(csv);

    const grupo = findGrupo(rows, q);
    if (!grupo) return json({ status: "NO_BASE" });

    const log = await getLog();
    const ya = log.some(x => normRut(x.rut_comprador) === normRut(grupo.comprador.rut_comprador));

    return json({ status: ya ? "YA_ENTREGADO" : "PENDIENTE", grupo });
  } catch (e) {
    return json({ status: "ERROR", error: String(e) }, 500);
  }
};

// utils
function json(obj, status = 200) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function normRut(s) { return (s || "").toUpperCase().replace(/[.\-]/g, "").trim(); }

function parseBase(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delim).map(h => h.toLowerCase().replace(/\s+/g,"_").replace(/[^\w]/g,""));

  return lines.slice(1).map(line => {
    const cols = line.split(delim); const o = {};
    header.forEach((h,i)=> o[h] = (cols[i] || "").trim());
    return {
      rut:               o.rut || "",
      nombre:            o.nombre || o["nombre_completo"] || "",
      categoria:         o.categoria || o["welcome_pack"] || "",
      tribuna:           o.tribuna || "",
      sector:            o.sector || "",
      rut_comprador:     o.rut_comprador || o["rutcomprador"] || "",
      nombre_comprador:  o.nombre_comprador || ""
    };
  });
}

function findGrupo(rows, qRut) {
  if (!qRut) return null;
  const hit = rows.find(r => normRut(r.rut) === qRut || normRut(r.rut_comprador) === qRut);
  if (!hit) return null;

  const rutComprador = hit.rut_comprador || hit.rut;
  const miembros = rows.filter(r =>
    normRut(r.rut_comprador) === normRut(rutComprador) ||
    normRut(r.rut) === normRut(rutComprador)
  );

  return {
    comprador: {
      rut_comprador: rutComprador,
      nombre_comprador: hit.nombre_comprador || ""
    },
    miembros
  };
}
