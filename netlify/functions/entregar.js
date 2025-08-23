// netlify/functions/entregar.js
// Registra la ENTREGA TOTAL del grupo, guardando en Netlify Blobs y bloqueando duplicados

import { getStore } from '@netlify/blobs';

// === Blobs con credenciales manuales (Plan B) ===
const store = getStore({
  name: 'welcome-packs',
  siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
  token: process.env.BLOBS_TOKEN
});

// ---------- Helpers ----------
const norm = s => (s || '').toUpperCase().replace(/[.\-]/g, '').trim();
const sinAcentos = s => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');
const normCat = c => {
  const x = sinAcentos(String(c || '').toUpperCase().trim());
  if (['ESTANDAR', 'NINO', 'PREMIUM'].includes(x)) return x;
  if (/NIN/.test(x)) return 'NINO';
  if (/PREM/.test(x)) return 'PREMIUM';
  return 'ESTANDAR';
};

function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const cand = [',', ';'];
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
  return { headers, rows };
}

const normKey = k => sinAcentos(String(k || '')).toLowerCase().replace(/\uFEFF/g, '').replace(/[\s_]/g, '');
function buildIndex(row) {
  const idx = {};
  for (const k of Object.keys(row)) idx[normKey(k)] = k;
  return idx;
}
function pick(row, idx, ...names) {
  for (const n of names) { const key = idx[normKey(n)]; if (key && row[key] !== undefined && row[key] !== '') return row[key]; }
  return '';
}

function mapBaseRow(r) {
  const idx = buildIndex(r);
  return {
    rut:          norm(pick(r, idx, 'rut', 'RUT', 'Rut')),
    nombre:       pick(r, idx, 'nombre', 'Nombre Completo', 'Nombre'),
    categoria:    normCat(pick(r, idx, 'categoria', 'Welcome Pack', 'Categoria Pack', 'Pack')),
    rut_comprador:norm(pick(r, idx, 'rut_comprador', 'Rut Comprador', 'RUT COMPRADOR', 'RutComprador')),
    nombre_comprador: pick(r, idx, 'nombre_comprador', 'Nombre Comprador', 'NombreComprador', 'Comprador'),
    tribuna:      pick(r, idx, 'tribuna', 'Tribuna'),
    sector:       pick(r, idx, 'sector', 'Sector')
  };
}

const toCSV = (headers, rows) => {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(',')].concat(rows.map(r => headers.map(h => esc(r[h])).join(','))).join('\n');
};

// ---------- Lecturas/Escrituras ----------
async function readBase() {
  const url = process.env.BASE_CSV_URL; // CSV final (OneDrive download=1 o GitHub raw)
  if (!url) throw new Error('Falta BASE_CSV_URL');
  const txt = await (await fetch(url)).text();
  const { rows } = parseCSV(txt);
  return rows.map(mapBaseRow).filter(r => r.rut || r.rut_comprador);
}
async function readLog() {
  const txt = (await store.get('registro_entregas.csv')) || '';
  if (!txt.trim()) return [];
  const { rows } = parseCSV(txt);
  return rows;
}
async function writeLog(rows) {
  const headers = [
    "rut","nombre","categoria",
    "rut_comprador","nombre_comprador","tribuna","sector",
    "receptor_rut","receptor_nombre",
    "retirado","retirado_at",
    "problema","problema_tipo","nota"
  ];
  await store.set('registro_entregas.csv', toCSV(headers, rows));
}

// ---------- Handler ----------
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST')
      return { statusCode: 405, body: 'Method not allowed' };

    const body = JSON.parse(event.body || '{}');
    const rutQ = norm(body.rut_busqueda || '');
    const receptor_rut = norm(body.receptor_rut || '');
    const receptor_nombre = (body.receptor_nombre || '').trim();
    if (!rutQ || !receptor_rut || !receptor_nombre)
      return { statusCode: 400, body: JSON.stringify({ ok:false, error:'Datos incompletos' }) };

    // 1) Localizar compra/grupo
    const base = await readBase();
    const hit = base.find(r => r.rut === rutQ || r.rut_comprador === rutQ);
    if (!hit) return { statusCode: 200, body: JSON.stringify({ ok:false, error:'NO_BASE' }) };

    const miembros = base.filter(r => r.rut_comprador === hit.rut_comprador);

    // 2) Bloquear duplicados
    const log = await readLog();
    const entregadas = log.filter(
      l => norm(l.rut_comprador) === hit.rut_comprador && (l.retirado || '').toUpperCase() === 'Y'
    ).length;
    if (entregadas >= miembros.length)
      return { statusCode: 200, body: JSON.stringify({ ok:false, error:'YA_ENTREGADO' }) };

    // 3) Registrar ENTREGAR TODO (una fila por persona del grupo)
    const ts = new Date().toISOString();
    const nuevas = miembros.map(m => ({
      rut: m.rut,
      nombre: m.nombre,
      categoria: normCat(m.categoria),
      rut_comprador: m.rut_comprador,
      nombre_comprador: m.nombre_comprador,
      tribuna: m.tribuna,
      sector: m.sector,
      receptor_rut,
      receptor_nombre,
      retirado: 'Y',
      retirado_at: ts,
      problema: 'N',
      problema_tipo: '',
      nota: ''
    }));

    await writeLog(log.concat(nuevas));
    return { statusCode: 200, body: JSON.stringify({ ok: true, entregados: nuevas.length }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: e.message }) };
  }
}
