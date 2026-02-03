// netlify/functions/buscar.js
const { json, normalizeRut, rutBody } = require("./_log_utils");

async function loadCsv(url) {
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error(`No pude descargar CSV. HTTP ${res.status}`);
  return await res.text();
}

function parseCsvSemicolon(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
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
  return {
    rut_comprador: r["Rut Comprador"] || "",
    nombre_comprador: r["Nombre Comprador"] || "",
    email_comprador: r["Email Comprador"] || "",
    rut: r["Rut"] || "",
    nombre: r["Nombre Completo"] || "",
    categoria: r["Welcome Pack"] || "",
    tribuna: r["Tribuna"] || "",
    sector: r["Sector"] || "",
    entregado: r["Entregado"] || "",
    fecha_entrega: r["Fecha entrega"] || "", // si existe en tu CSV
    rut_receptor: r["Rut receptor"] || "",   // si existe en tu CSV
    nombre_receptor: r["Nombre receptor"] || "",
  };
}

exports.handler = async (event) => {
  try {
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { status: "ERROR", error: "Falta BASE_CSV_URL" });

    const rutQuery = event.queryStringParameters?.rut || "";
    const rutNorm = normalizeRut(rutQuery);
    const rutQBody = rutBody(rutQuery);

    if (!rutNorm || !rutQBody) return json(400, { status: "ERROR", error: "RUT inválido o vacío" });

    const csv = await loadCsv(baseUrl);
    const { rows } = parseCsvSemicolon(csv);
    const mapped = rows.map(mapRow);

    // ✅ Match por CUERPO (ignora si el usuario puso/omitió DV; nosotros lo calculamos igual)
    const match = mapped.find((x) => rutBody(x.rut) === rutQBody);
    if (!match) return json(200, { status: "NO_ENCONTRADO" });

    // Grupo = todos los que comparten el mismo comprador (por cuerpo)
    const compradorBody = rutBody(match.rut_comprador);
    const grupo = mapped.filter((x) => rutBody(x.rut_comprador) === compradorBody);

    const miembros = grupo.map((m) => ({
      rut: normalizeRut(m.rut),
      nombre: m.nombre,
      categoria: (m.categoria || "").trim(),
      tribuna: (m.tribuna || "").trim(),
      sector: (m.sector || "").trim(),
      entregado: String(m.entregado || "").trim(),
    }));

    // Estado grupo: si existe marca de entregado en cualquiera => YA_ENTREGADO
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
