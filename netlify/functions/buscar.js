// netlify/functions/buscar.js
// Busca un RUT en la base final (CSV) y devuelve PENDIENTE / YA_ENTREGADO / NO_BASE

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

// Quita BOM, detecta delimitador simple (, o ;)
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

// Normaliza claves de fila para leer por alias (ignora BOM, espacios, _, acentos, case)
const normKey = k => sinAcentos(String(k || '')).toLowerCase().replace(/\uFEFF/g, '').replace(/[\s_]/g, '');
function buildIndex(row) {
  const idx = {};
  for (const k of Object.keys(row)) idx[normKey(k)] = k;
  return idx;
}
function pick(row, idx, ...nombresPosibles) {
  for (const name of nombresPosibles) {
    const key = idx[normKey(name)];
    if (key && row[key] !== undefined && row[key] !== '') return row[key];
  }
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
    sector:       pick(r, idx, 'sector', 'Sector'),
    email_comprador: pick(r, idx, 'email_comprador', 'Email Comprador', 'Correo Comprador', 'Email')
  };
}

const resumenCats = (miembros) => {
  const m = new Map();
  miembros.forEach(x => { const c = normCat(x.categoria); m.set(c, (m.get(c) || 0) + 1); });
  return Array.from(m.entries()).map(([c, n]) => `${n} - ${c}`);
};

// ---------- Lecturas ----------
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
  return rows.map(r => ({
    rut: norm(r.rut),
    rut_comprador: norm(r.rut_comprador),
    retirado: (r.retirado || '').toUpperCase(),
  }));
}

// ---------- Handler ----------
export async function handler(event) {
  try {
    const rut = norm(event.queryStringParameters?.rut || '');
    if (!rut) return { statusCode: 400, body: JSON.stringify({ error: 'RUT vacío' }) };

    const base = await readBase();
    const hit = base.find(r => r.rut === rut || r.rut_comprador === rut);
    if (!hit) return { statusCode: 200, body: JSON.stringify({ status: 'NO_BASE' }) };

    const miembros = base.filter(r => r.rut_comprador === hit.rut_comprador);

    const log = await readLog();
    const entregadas = log.filter(l => l.rut_comprador === hit.rut_comprador && l.retirado === 'Y').length;
    const status = entregadas >= miembros.length ? 'YA_ENTREGADO' : 'PENDIENTE';

    return {
      statusCode: 200,
      body: JSON.stringify({ status, grupo: { comprador: hit, miembros, resumen: resumenCats(miembros) } })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}
