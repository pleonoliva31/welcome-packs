// netlify/functions/debug_pack_2026.js
const { json, okCors } = require("./_log_utils");

async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar BASE_CSV_URL. HTTP ${res.status}`);
  return await res.text();
}

function parseSemicolonSimple(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(";").map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (cols[idx] ?? "").trim()));
    rows.push(obj);
  }
  return { headers, rows };
}

function norm(s) {
  return String(s || "").toUpperCase().trim();
}

function ubicacionFromSector(sectorRaw, packRaw) {
  const sector = norm(sectorRaw);

  // regla: Premium Seat por Pack (no por texto del sector)
  if (norm(packRaw) === "PREMIUM SEAT") return "PREMIUM SEAT";

  if (sector.includes("PRIETO")) return "PRIETO";
  if (sector.includes("LEPE")) return "LEPE";
  if (sector.includes("FOUILLIOUX")) return "FOUILLIOUX";
  if (sector.includes("LIVINGSTONE")) return "LIVINGSTONE";

  // OJO: si cae acá, lo contamos igual para no “perder” filas
  return "SIN_UBICACION";
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();
    if (event.httpMethod !== "GET") return json(405, { ok:false, error:"Method not allowed" });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json(500, { ok:false, error:"Falta BASE_CSV_URL" });

    const raw = await loadText(baseUrl);
    const { headers, rows } = parseSemicolonSimple(raw);

    // headers esperados nuevos
    const H_PACK = "Pack";
    const H_SECTOR = "Sector";
    const H_RUT = "Rut";
    const H_CAT = "Categoria";

    const countsByPack = {};
    const countsByUbic = {};
    const samplesSinUbic = [];

    let totalRows = rows.length;
    let totalConPack = 0;        // Pack != No
    let totalSi = 0;
    let totalPremiumSeat = 0;

    for (const r of rows) {
      const pack = norm(r[H_PACK]);
      countsByPack[pack] = (countsByPack[pack] || 0) + 1;

      if (pack === "SI" || pack === "PREMIUM SEAT") {
        totalConPack++;
        if (pack === "SI") totalSi++;
        if (pack === "PREMIUM SEAT") totalPremiumSeat++;

        const ubic = ubicacionFromSector(r[H_SECTOR], r[H_PACK]);
        countsByUbic[ubic] = (countsByUbic[ubic] || 0) + 1;

        if (ubic === "SIN_UBICACION" && samplesSinUbic.length < 50) {
          samplesSinUbic.push({
            rut: r[H_RUT],
            categoria: r[H_CAT],
            sector: r[H_SECTOR],
            pack: r[H_PACK],
          });
        }
      }
    }

    return json(200, {
      ok: true,
      total_rows: totalRows,
      pack_values_count: countsByPack,
      total_con_pack: totalConPack,
      total_si: totalSi,
      total_premium_seat: totalPremiumSeat,
      ubic_count: countsByUbic,
      sin_ubicacion_muestras: samplesSinUbic,
      headers
    });

  } catch (e) {
    return json(500, { ok:false, error: String(e?.message || e) });
  }
};
