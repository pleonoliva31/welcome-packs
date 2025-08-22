// netlify/functions/entregar.js
import { getStore } from '@netlify/blobs';

const store = getStore({ name: 'welcome-packs' });

// Helpers
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
const toCSV = (headers, rows) => {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(',')].concat(rows.map(r => headers.map(h => esc(r[h])).join(','))).join('\n');
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

async function readBase() {
  const url = process.env.BASE_CSV_URL;
  if (!url) throw new Error('Falta BASE_CSV_URL');
  const txt = await (await fetch(url)).text();
  const { rows } = parseCSV(txt);
  return rows.map(mapBaseRow);
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

    const base = await readBase();
    const hit = base.find(r => r.rut === rutQ || r.rut_comprador === rutQ);
    if (!hit) return { statusCode: 200, body: JSON.stringify({ ok:false, error:'NO_BASE' }) };

    const miembros = base.filter(r => r.rut_comprador === hit.rut_comprador);

    const log = await readLog();
    const entregadas = log.filter(l => norm(l.rut_comprador) === hit.rut_comprador && (l.retirado || '').toUpperCase() === 'Y').length;
    if (entregadas >= miembros.length)
      return { statusCode: 200, body: JSON.stringify({ ok:false, error:'YA_ENTREGADO' }) };

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
