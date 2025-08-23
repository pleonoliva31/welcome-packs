// netlify/functions/entregar.js
import { getLog, putLog } from "./_log_utils.js";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json({ ok:false, error:"METHOD_NOT_ALLOWED" }, 405);
    const body = JSON.parse(event.body || "{}");
    const rutBusqueda     = normRut(body.rut_busqueda || "");
    const receptor_rut    = normRut(body.receptor_rut || "");
    const receptor_nombre = (body.receptor_nombre || "").trim();

    if (!rutBusqueda || !receptor_rut || !receptor_nombre) {
      return json({ ok:false, error:"FALTAN_PARAMETROS" }, 400);
    }

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json({ ok:false, error:"NO_BASE_URL" }, 500);

    const res = await fetch(baseUrl, { cache:"no-store" });
    if (!res.ok) return json({ ok:false, error:"CSV_FETCH_ERROR" }, 500);
    const csv = await res.text();
    const rows = parseBase(csv);

    const grupo = findGrupo(rows, rutBusqueda);
    if (!grupo) return json({ ok:false, error:"RUT_NO_ENCONTRADO" }, 404);

    const log = await getLog();
    const ya = log.some(x => normRut(x.rut_comprador) === normRut(grupo.comprador.rut_comprador));
    if (ya) return json({ ok:false, error:"YA_ENTREGADO" }, 400);

    const pertenece = grupo.miembros.some(m => normRut(m.rut) === receptor_rut);
    if (!pertenece) {
      return json({ ok:false, error:"El RUT ingresado no corresponde a este abono" }, 400);
    }

    const detalle = resumenPorCategoria(grupo.miembros);
    await putLog({
      rut_receptor: receptor_rut,
      nombre_receptor: receptor_nombre,
      rut_comprador: grupo.comprador.rut_comprador,
      nombre_comprador: grupo.comprador.nombre_comprador,
      total_packs: detalle.reduce((s,d)=> s+d.cantidad, 0),
      detalle,
      detalle_texto: detalle.map(d=>`${d.cantidad} ${d.cat}`).join(" · "),
      ts: new Date().toISOString()
    });

    return json({ ok:true });
  } catch (e) {
    return json({ ok:false, error:String(e) }, 500);
  }
};

// utils
function json(obj, status=200){ return { statusCode: status, headers:{ "Content-Type":"application/json" }, body: JSON.stringify(obj) }; }
function normRut(s){ return (s||"").toUpperCase().replace(/[.\-]/g,"").trim(); }

function parseBase(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delim).map(h=>h.toLowerCase().replace(/\s+/g,"_").replace(/[^\w]/g,""));

  return lines.slice(1).map(line=>{
    const cols=line.split(delim); const o={}; header.forEach((h,i)=>o[h]=(cols[i]||"").trim());
    return {
      rut: o.rut || "",
      nombre: o.nombre || o["nombre_completo"] || "",
      categoria: o.categoria || o["welcome_pack"] || "",
      tribuna: o.tribuna || "",
      sector: o.sector || "",
      rut_comprador: o.rut_comprador || o["rutcomprador"] || "",
      nombre_comprador: o.nombre_comprador || ""
    };
  });
}

function findGrupo(rows, qRut){
  const hit = rows.find(r => normRut(r.rut)===qRut || normRut(r.rut_comprador)===qRut);
  if (!hit) return null;
  const rutComprador = hit.rut_comprador || hit.rut;
  const miembros = rows.filter(r =>
    normRut(r.rut_comprador)===normRut(rutComprador) ||
    normRut(r.rut)===normRut(rutComprador)
  );
  return { comprador:{ rut_comprador: rutComprador, nombre_comprador: hit.nombre_comprador || "" }, miembros };
}

function resumenPorCategoria(miembros){
  const acc = {};
  miembros.forEach(m => {
    const k = (m.categoria||"").toUpperCase();
    acc[k] = (acc[k]||0)+1;
  });
  return Object.entries(acc).map(([cat,cantidad])=>({ cat, cantidad }));
}
