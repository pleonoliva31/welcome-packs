// netlify/functions/buscar.js
// Busca un RUT en la base y devuelve estado + rut_buscado + nombre_buscado

import { getStore } from '@netlify/blobs';

const store = getStore({
  name: 'welcome-packs',
  siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
  token: process.env.BLOBS_TOKEN
});

const norm = s => (s || '').toUpperCase().replace(/[.\-]/g, '').trim();
const sinAcentos = s => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');
const normKey = k => sinAcentos(String(k || '')).toLowerCase().replace(/\uFEFF/g, '').replace(/[\s_]/g, '');

const ALIAS = {
  rut: ['rut','Rut','RUT','RUN','RUT ABONADO','RUT COMPRADOR','RUT TITULAR'],
  rut_comprador: ['rut_comprador','Rut Comprador','RUT COMPRADOR','RUT TITULAR'],
  nombre: ['nombre','Nombre','Nombre Completo'],
  nombre_comprador: ['nombre_comprador','Nombre Comprador','Nombre Titular'],
  categoria: ['categoria','Welcome Pack','Categoria Pack','Pack'],
  tribuna: ['tribuna','Tribuna','Localidad'],
  sector: ['sector','Sector','Sección']
};

function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delim).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(delim);
    const o = {}; headers.forEach((h,i)=> o[h]=cells[i]?.trim() ?? ''); return o;
  });
  return { headers, rows };
}
const buildIndex = row => { const idx={}; Object.keys(row).forEach(k=> idx[normKey(k)]=k); return idx; };
const pick = (row, idx, names) => { for(const n of names){const k=idx[normKey(n)]; if(k && row[k]) return row[k];} return ''; };
const normCat = c => {const x=sinAcentos((c||'').toUpperCase()); if(/PREM/.test(x)) return 'PREMIUM'; if(/NIN/.test(x)) return 'NINO'; return 'ESTANDAR';};

function mapBaseRow(r){
  const idx=buildIndex(r);
  return {
    rut: norm(pick(r, idx, ALIAS.rut)),
    nombre: pick(r, idx, ALIAS.nombre),
    categoria: normCat(pick(r, idx, ALIAS.categoria)),
    rut_comprador: norm(pick(r, idx, ALIAS.rut_comprador)) || norm(pick(r, idx, ALIAS.rut)),
    nombre_comprador: pick(r, idx, ALIAS.nombre_comprador) || pick(r, idx, ALIAS.nombre),
    tribuna: pick(r, idx, ALIAS.tribuna),
    sector: pick(r, idx, ALIAS.sector)
  };
}

async function readBase(){
  const url=process.env.BASE_CSV_URL;
  if(!url) throw new Error('Falta BASE_CSV_URL');
  const txt=await (await fetch(url)).text();
  const {rows}=parseCSV(txt);
  return rows.map(mapBaseRow).filter(r=>r.rut || r.rut_comprador);
}
async function readLog(){
  const txt=(await store.get('registro_entregas.csv'))||'';
  if(!txt.trim()) return [];
  const {rows}=parseCSV(txt);
  return rows.map(r=>({ rut:norm(r.rut), rut_comprador:norm(r.rut_comprador), retirado:(r.retirado||'').toUpperCase() }));
}

export async function handler(event){
  try{
    const rutRaw = event.queryStringParameters?.rut || '';
    const rut = norm(rutRaw);
    if(!rut) return {statusCode:400, body:JSON.stringify({error:'RUT vacío'})};

    const base=await readBase();
    const hit=base.find(r=> r.rut===rut || r.rut_comprador===rut);
    if(!hit) return {statusCode:200, body:JSON.stringify({status:'NO_BASE'})};

    const miembros=base.filter(r=> r.rut_comprador===hit.rut_comprador);

    // nuevo: calcular nombre de la persona buscada (si el rut pertenece a un miembro)
    const buscado = miembros.find(m => m.rut === rut);
    const nombreBuscado = buscado?.nombre || '';

    const log=await readLog();
    const entregadas=log.filter(l=> l.rut_comprador===hit.rut_comprador && l.retirado==='Y').length;
    const status= entregadas>=miembros.length? 'YA_ENTREGADO':'PENDIENTE';

    return {
      statusCode:200,
      body:JSON.stringify({
        status,
        rut_buscado: rutRaw,
        nombre_buscado: nombreBuscado,
        grupo:{comprador:hit, miembros}
      })
    };
  }catch(e){ return {statusCode:500, body:JSON.stringify({error:e.message})}; }
}
