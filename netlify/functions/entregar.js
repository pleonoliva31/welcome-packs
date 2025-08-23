// netlify/functions/entregar.js
import { getStore } from '@netlify/blobs';

const store = getStore({
  name: 'welcome-packs',
  siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
  token: process.env.BLOBS_TOKEN
});

const norm = s => (s||'').toUpperCase().replace(/[.\-]/g,'').trim();

function parseCSV(text){
  const clean=text.replace(/^\uFEFF/,'').replace(/\r/g,'');
  const lines=clean.split('\n').filter(Boolean);
  if(!lines.length) return {headers:[], rows:[]};
  const delim=lines[0].includes(';')?';':',';
  const headers=lines[0].split(delim).map(h=>h.trim());
  const rows=lines.slice(1).map(l=>{
    const c=l.split(delim); const o={}; headers.forEach((h,i)=>o[h]=c[i]?.trim()??''); return o;
  });
  return {headers, rows, delim};
}
function toCSV(headers, rows, delim=','){
  const head = headers.join(delim);
  const body = rows.map(r=> headers.map(h => (r[h]??'')).join(delim)).join('\n');
  return head + (rows.length?'\n':'') + body;
}

// lee base desde OneDrive (BASE_CSV_URL), misma lógica que usar en buscar.js
function sinAcentos(s){ return (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,''); }
function normKey(k){ return sinAcentos(String(k||'')).toLowerCase().replace(/\uFEFF/g,'').replace(/[\s_]/g,''); }
const ALIAS = {
  rut: ['rut','Rut','RUT','RUN','RUT ABONADO','RUT COMPRADOR','RUT TITULAR'],
  rut_comprador: ['rut_comprador','Rut Comprador','RUT COMPRADOR','RUT TITULAR'],
  nombre: ['nombre','Nombre','Nombre Completo'],
  nombre_comprador: ['nombre_comprador','Nombre Comprador','Nombre Titular'],
  categoria: ['categoria','Welcome Pack','Categoria Pack','Pack'],
  tribuna: ['tribuna','Tribuna','Localidad'],
  sector: ['sector','Sector','Sección']
};
function parseBaseCSV(text){
  const clean=text.replace(/^\uFEFF/,'').replace(/\r/g,'');
  const lines=clean.split('\n').filter(Boolean);
  if(!lines.length) return [];
  const delim=lines[0].includes(';')?';':',';
  const headers=lines[0].split(delim).map(h=>h.trim());
  const rows=lines.slice(1).map(l=>{
    const c=l.split(delim); const o={}; headers.forEach((h,i)=>o[h]=c[i]?.trim()??''); return o;
  });
  const buildIndex = row => { const idx={}; Object.keys(row).forEach(k=> idx[normKey(k)]=k); return idx; };
  const pick = (row, idx, names) => { for(const n of names){ const k=idx[normKey(n)]; if(k && row[k]) return row[k]; } return ''; };
  const normCat = c => { const x=sinAcentos((c||'').toUpperCase()); if(/PREM/.test(x)) return 'PREMIUM'; if(/NIN/.test(x)) return 'NINO'; return 'ESTANDAR'; };

  return rows.map(r=>{
    const idx = buildIndex(r);
    return {
      rut: norm(pick(r, idx, ALIAS.rut)),
      nombre: pick(r, idx, ALIAS.nombre),
      categoria: normCat(pick(r, idx, ALIAS.categoria)),
      rut_comprador: norm(pick(r, idx, ALIAS.rut_comprador)) || norm(pick(r, idx, ALIAS.rut)),
      nombre_comprador: pick(r, idx, ALIAS.nombre_comprador) || pick(r, idx, ALIAS.nombre),
      tribuna: pick(r, idx, ALIAS.tribuna),
      sector: pick(r, idx, ALIAS.sector)
    };
  }).filter(r=> r.rut || r.rut_comprador);
}

async function readBase(){
  const url = process.env.BASE_CSV_URL;
  if(!url) throw new Error('Falta BASE_CSV_URL');
  const txt = await (await fetch(url)).text();
  return parseBaseCSV(txt);
}
async function readLog(){
  const txt = (await store.get('registro_entregas.csv')) || '';
  if(!txt.trim()){
    return {
      headers: ['rut','nombre','categoria','tribuna','sector','rut_comprador','nombre_comprador','rut_receptor','receptor_nombre','retirado_at'],
      rows: [],
      delim: ','
    };
  }
  const parsed = parseCSV(txt);
  // asegurar headers estándar
  const headers = [
    'rut','nombre','categoria','tribuna','sector',
    'rut_comprador','nombre_comprador',
    'rut_receptor','receptor_nombre','retirado_at'
  ];
  // normalizamos rows al set de headers
  const normRows = parsed.rows.map(r=>{
    const o={}; headers.forEach(h=> o[h]= r[h]??''); return o;
  });
  return {headers, rows: normRows, delim: parsed.delim || ','};
}

export async function handler(event){
  try{
    if(event.httpMethod!=='POST') return {statusCode:405, body:'Method Not Allowed'};
    const body = JSON.parse(event.body||'{}');
    const rutBusqueda = norm(body.rut_busqueda||'');
    const rutReceptor = norm(body.receptor_rut||'');
    const receptorNombre = (body.receptor_nombre||'').trim();
    if(!rutBusqueda || !rutReceptor || !receptorNombre){
      return {statusCode:400, body:JSON.stringify({ok:false, error:'Campos incompletos'})};
    }

    // Base
    const base = await readBase();
    const hit = base.find(r=> r.rut===rutBusqueda || r.rut_comprador===rutBusqueda);
    if(!hit) return {statusCode:200, body:JSON.stringify({ok:false, error:'RUT no está en la base'})};

    const miembros = base.filter(r=> r.rut_comprador===hit.rut_comprador);

    // Validación: receptor debe pertenecer al grupo
    const receptorEnGrupo = miembros.some(m=> m.rut === rutReceptor);
    if(!receptorEnGrupo){
      return {statusCode:200, body:JSON.stringify({ok:false, error:'El RUT ingresado no corresponde a este abono'})};
    }

    // Cargar log y verificar si ya estaba 100% entregado
    const log = await readLog();
    const yaEntregadas = log.rows.filter(r=> r.rut_comprador===hit.rut_comprador);
    if(yaEntregadas.length >= miembros.length){
      return {statusCode:200, body:JSON.stringify({ok:false, error:'Welcome packs ya fueron entregados para este grupo'})};
    }

    // Escribir filas (una por miembro) con rut_receptor y receptor_nombre
    const now = new Date().toISOString();
    const nuevas = miembros.map(m=>({
      rut: m.rut,
      nombre: m.nombre,
      categoria: m.categoria,
      tribuna: m.tribuna,
      sector: m.sector,
      rut_comprador: hit.rut_comprador,
      nombre_comprador: hit.nombre_comprador,
      rut_receptor: rutReceptor,
      receptor_nombre: receptorNombre,
      retirado_at: now
    }));

    const allRows = [...log.rows, ...nuevas];
    const csv = toCSV(log.headers, allRows, log.delim || ',');
    await store.set('registro_entregas.csv', csv, { addRandomSuffix:false });

    return {statusCode:200, body:JSON.stringify({ok:true, entregados:nuevas.length})};
  }catch(e){
    return {statusCode:500, body:JSON.stringify({ok:false, error:e.message})};
  }
}
