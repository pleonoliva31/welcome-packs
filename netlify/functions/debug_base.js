// netlify/functions/debug_base.js
// Inspecciona la BASE_CSV_URL: muestra headers detectados y 3 filas de ejemplo (raw y mapeadas)

const sinAcentos = s => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');
const normKey = k => sinAcentos(String(k || '')).toLowerCase().replace(/\uFEFF/g, '').replace(/[\s_]/g, '');

function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const cand = [',', ';', '\t'];
  let bestDelim = ',', bestCols = 0;
  for (const d of cand) {
    const cols = lines[0].split(d).length;
    if (cols > bestCols) { bestCols = cols; bestDelim = d; }
  }
  const headers = lines[0].split(bestDelim).map(h => h.replace(/\uFEFF/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(bestDelim);
    const o = {};
    headers.forEach((h, i) => o[h] = (cells[i] ?? '').trim());
    return o;
  });
  return { headers, rows, delim: bestDelim };
}

const pick = (row, idx, names) => {
  for (const n of names) {
    const k = idx[normKey(n)];
    if (k && row[k] !== undefined && row[k] !== '') return row[k];
  }
  return '';
};

export async function handler() {
  try {
    const url = process.env.BASE_CSV_URL;
    if (!url) return { statusCode: 500, body: 'Falta BASE_CSV_URL' };

    const txt = await (await fetch(url)).text();
    const { headers, rows, delim } = parseCSV(txt);

    const idx = {};
    headers.forEach(h => idx[normKey(h)] = h);

    const sampleRaw = rows.slice(0, 3);
    const aliases = {
      rut: ['rut', 'RUT', 'Rut', 'RUN', 'RUT ASOCIADO', 'RUT ABONADO', 'RUT PERSONA', 'RUT TITULAR', 'RUT SOCIO', 'RUT USUARIO'],
      rut_comprador: ['rut_comprador', 'Rut Comprador', 'RUT COMPRADOR', 'RUT TITULAR', 'RUT SOCIO TITULAR', 'RUT COMPRA', 'RUT GRUPO'],
      nombre: ['nombre', 'Nombre', 'Nombre Completo'],
      nombre_comprador: ['nombre_comprador', 'Nombre Comprador', 'Nombre Titular', 'Comprador', 'Titular'],
      categoria: ['categoria', 'Welcome Pack', 'Categoria Pack', 'Pack', 'Tipo Pack'],
      tribuna: ['tribuna', 'Tribuna', 'Localidad', 'Ubicacion'],
      sector: ['sector', 'Sector', 'Sección']
    };

    const detectados = {};
    for (const k of Object.keys(aliases)) {
      detectados[k] = aliases[k].map(a => idx[normKey(a)]).find(Boolean) || null;
    }

    const mapped = sampleRaw.map(r => {
      const idr = {};
      Object.keys(idx).forEach(nk => idr[idx[nk]] = r[idx[nk]]);
      return {
        raw: idr,
        mapeado: {
          rut: pick(r, idx, aliases.rut),
          rut_comprador: pick(r, idx, aliases.rut_comprador),
          nombre: pick(r, idx, aliases.nombre),
          nombre_comprador: pick(r, idx, aliases.nombre_comprador),
          categoria: pick(r, idx, aliases.categoria),
          tribuna: pick(r, idx, aliases.tribuna),
          sector: pick(r, idx, aliases.sector),
        }
      };
    });

    return {
      statusCode: 200,
      headers: {'content-type':'application/json'},
      body: JSON.stringify({
        ok: true,
        delim_usado: (delim === '\t' ? '\\t (tab)' : delim),
        headers_originales: headers,
        headers_normalizados: Object.fromEntries(headers.map(h => [h, normKey(h)])),
        campos_detectados: detectados,
        ejemplos: mapped
      }, null, 2)
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
}
