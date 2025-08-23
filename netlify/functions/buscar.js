// netlify/functions/buscar.js
// Busca un RUT en la base final (CSV) y devuelve PENDIENTE / YA_ENTREGADO / NO_BASE

import { getStore } from '@netlify/blobs';

// === Configuración de Blobs con credenciales manuales ===
// (Usa las variables de entorno que creaste en Netlify)
const store = getStore({
  name: 'welcome-packs',
  siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
  token: process.env.BLOBS_TOKEN
});

// ---------- Helpers ----------
const norm = s => (s || '').toUpperCase().replace(/[.\-]/g, '').trim();
const noAcc = s => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');
const normCat = c => {
  const x = noAcc(String(c || '').toUpperCase().trim());
  if (['ESTANDAR', 'NINO', 'PREMIUM'].includes(x)) return x;
  if (/NIN/.test(x)) return 'NINO';
  if (/PREM/.test(x)) return 'PREMIUM';
  return 'ESTANDAR';
};
const parseCSV = (text) => {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = (lines[0].includes(';') && !lines[0].includes(',')) ? ';' : ',';
  const headers = lines[0].split(delim).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(delim);
    const o = {};
    headers.forEach((h, i) => o[h] = (cells[i] ?? '').trim());
    return o;
  });
  return { headers, rows };
};
const mapBaseRow = (r) => ({
  rut: norm(r.rut || r['Rut']),
  nombre: r.nombre || r['Nombre Completo'] || '',
  categoria: normCat(r.categoria || r['Welcome Pack']),
  rut_comprador: norm(r.rut_comprador || r['Rut Comprador']),
  nombre_comprador: r.nombre_comprador || r['Nombre Comprador'] || '',
  tribuna: r.tribuna || r['Tribuna'] || '',
  sector: r.sector || r['Sector'] || '',
});
const resumenCats = (miembros) => {
  const m = new Map();
  miembros.forEach(x => {
    const c = normCat(x.categoria);
    m.set(c, (m.get(c) || 0) + 1);
  });
  return Array.from(m.entries()).map(([c, n]) => `${n} - ${c}`);
};

// ---------- Lecturas ----------
async function readBase() {
  const url = process.env.BASE_CSV_URL; // CSV final (OneDrive con download=1)
  if (!url) throw new Error('Falta BASE_CSV_URL');
  const txt = await (await fetch(url)).text();
  const { rows } = parseCSV(txt);
  return rows.map(mapBaseRow);
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
