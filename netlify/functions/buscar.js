import { getStore } from '@netlify/blobs';

const store = getStore({
  name: 'welcome-packs',
  siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
  token: process.env.BLOBS_TOKEN
});

const norm = s => (s || '').toUpperCase().replace(/[.\-]/g, '').trim();
const sinAcentos = s => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');

function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const cand = [',', ';', '\t'];
  let bestDelim = ',', bestCols = 0;
  for (const d of cand) { const c = lines[0].split(d).length; if (c > bestCols) { bestCols = c; bestDelim = d; } }
  const headers = lines[0].split(bestDelim).map(h => h.replace(/\uFEFF/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(bestDelim);
    const o = {}; headers.forEach((h, i) => o[h] = (cells[i] ?? '').trim()); return o;
  });
  return { headers, rows };
}

const normKey = k => sinAcentos(String(k || '')).toLowerCase().replace(/\uFEFF/g, '').replace(/[\s_]/g, '');
const buildIndex = row => { const idx = {}; Object.keys(row).forEach(k => idx[normKey(k)] = k); return idx; };
const pick = (row, idx, names) => { for (const n of names) { const k = idx[normKey(n)]; if (k && row[k] !== '') return row[k]; } return ''; };
const normCat = c => { const x = sinAcentos(String(c || '').toUpperCase().trim()); if (/PREM/.test(x)) return 'PREMIUM'; if (/NIN/.test(x)) return 'NINO'; return 'ESTANDAR'; };

const ALIAS = {
  rut: ['rut','RUT','Rut','RUN','RUT ASOCIADO','RUT ABONADO','RUT PERSONA','RUT TITULAR','RUT SOCIO','RUT USUARIO'],
  rut_comprador: ['rut_comprador','Rut Comprador','RUT COMPRADOR','RUT TITULAR','RUT SOCIO TITULAR','RUT COMPRA','RUT GRUPO','RUT TITULAR COMPRA'],
  nombre: ['nombre','Nombre','Nombre Completo'],
  nombre_comprador: ['nombre_comprador','Nombre Comprador','Nombre Titular','Comprador','Titular'],
  categoria: ['categoria','Welcome Pack','Categoria Pack','Pack','Tipo Pack'],
  tribuna: ['tribuna','Tribuna','Localidad','Ubicacion'],
  sector: ['sector','Sector','Sección']
};

function mapBaseRow(r){
  const idx = buildIndex(r);
  return {
    rut: norm(pick(r, idx, ALIAS.rut)),
    nombre: pick(r, idx, ALIAS.nombre),
    categoria: normCat(pick(r, idx, ALIAS.categoria)),
    rut_comprador: norm(pick(r, idx, ALIAS.rut_comprador)) || norm(pick(r, idx, ALIAS.rut)), // fallback: si no hay rut_comprador, usa rut
    nombre_comprador: pick(r, idx, ALIAS.nombre_comprador) || pick(r, idx, ALIAS.nombre),
    tribuna: pick(r, idx, ALIAS.tribuna),
    sector: pick(r, idx, ALIAS.sector)
  };
}

const resumenCats = (miembros) => {
  const m = new Map(); miembros.forEach(x => { const c = normCat(x.categoria); m.set(c, (m.get(c)||0)+1); });
  return Array.from(m.entries()).map(([c, n]) => `${n} - ${c}`);
};

async function readBase() {
  const url = process.env.BASE_CSV_URL;
  if (!url) throw new Error('Falta BASE_CSV_URL');
  const txt = await (await fetch(url)).text();
  const { rows } = parseCSV(txt);
  return rows.map(mapBaseRow).filter(r => r.rut || r.rut_comprador);
}

async function readLog() {
  const txt = (await store.get('registro_entregas.csv')) || '';
  if (!txt.trim()) return [];
  const { rows } = parseCSV(txt);
  return rows.map(r => ({ rut: norm(r.rut), rut_comprador: norm(r.rut_comprador), retirado: (r.retirado||'').toUpperCase() }));
}

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

    return { statusCode: 200, body: JSON.stringify({ status, grupo: { comprador: hit, miembros, resumen: resumenCats(miembros) } }) };
  } catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
}
