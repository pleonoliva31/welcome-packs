// netlify/functions/export_base.js
export const handler = async () => {
  try {
    const url = process.env.BASE_CSV_URL;
    if (!url) return json({ ok:false, error:"NO_BASE_URL" }, 500);

    const r = await fetch(url, { cache:"no-store" });
    if (!r.ok) return json({ ok:false, error:"CSV_FETCH_ERROR" }, 500);
    const csv = await r.text();

    const rows = parseBase(csv);
    return json(rows);
  } catch (e) {
    return json({ ok:false, error:String(e) }, 500);
  }
};

function json(obj, status=200) {
  return { statusCode: status, headers: { "Content-Type":"application/json" }, body: JSON.stringify(obj) };
}

function parseBase(text) {
  const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delim).map(h => h.toLowerCase().replace(/\s+/g,"_").replace(/[^\w]/g,""));

  return lines.slice(1).map(line => {
    const cols = line.split(delim);
    const o = {};
    header.forEach((h,i)=> o[h] = (cols[i] || "").trim());

    return {
      rut:             o.rut || "",
      nombre:          o.nombre || o["nombre_completo"] || "",
      categoria:       o.categoria || o["welcome_pack"] || "",
      tribuna:         o.tribuna || "",
      sector:          o.sector || "",
      entregado:       o.entregado || "",
      fecha_entrega:   o.fecha_entrega || "",
      rut_receptor:    o.rut_receptor || ""
    };
  });
}
