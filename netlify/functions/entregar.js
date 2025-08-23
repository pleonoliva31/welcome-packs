import { getStore } from '@netlify/blobs';

const sinAcentos = (s)=> (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'');
const normRut    = (s)=> (s||'').toUpperCase().replace(/[.\-]/g,'').trim();
const normKey    = (k)=> sinAcentos(String(k||'')).toLowerCase().replace(/\uFEFF/g,'').replace(/[\s_]/g,'');

const ALIAS = {
  rut:              ['rut','RUT','RUN','RUT ABONADO','RUT TITULAR','Rut Abonado'],
  nombre:           ['nombre','Nombre','Nombre Completo','NOMBRE COMPLETO'],
  categoria:        ['categoria','Welcome Pack','Categoria Pack','Pack','WELCOME PACK'],
  rut_comprador:    ['rut_comprador','Rut Comprador','RUT COMPRADOR','RUT TITULAR'],
  nombre_comprador: ['nombre_comprador','Nombre Comprador','Nombre Titular','NOMBRE TITULAR'],
  tribuna:          ['tribuna','Tribuna','Localidad'],
  sector:           ['sector','Sector','Sección','Seccion']
};

async function readBase(){
  const url = process.env.BASE_CSV_URL;
  if(!url) throw new Error('Falta BASE_CSV_URL');
  const txt = await (await fetch(url)).text();
  const clean = txt.replace(/^\uFEFF/, '').replace(/\r/g,'');
  const lines = clean.split('\n').filter(Boolean);
  if(!lines.length) return [];
  const delim = lines[0].includes(';')?';':',';
  const headers = lines[0].split(delim).map(h=>h.trim());
  const idx = {}; headers.forEach(h=> idx[normKey(h)] = h);

  const pick = (row, names) => { for(const n of names){ const k = idx[normKey(n)]; if(k && row[k]) return row[k]; } return ''; };
  const normCat = c=>{ const x = sinAcentos((c||'').toUpperCase()); if(/PREM/.test(x)) return 'PREMIUM'; if(/NIN/.test(x)) return 'NINO'; return 'ESTANDAR'; };

  const rows = lines.slice(1).map(l=>{
    const cells = l.split(delim); const row={}; headers.forEach((h,i)=> row[h]=(cells[i]??'').trim());
    const obj = {
      rut:              normRut(pick(row, ALIAS.rut)),
      nombre:           pick(row, ALIAS.nombre),
      categoria:        normCat(pick(row, ALIAS.categoria)),
      rut_comprador:    normRut(pick(row, ALIAS.rut_comprador)) || normRut(pick(row, ALIAS.rut)),
      nombre_comprador: pick(row, ALIAS.nombre_comprador) || pick(row, ALIAS.nombre),
      tribuna:          pick(row, ALIAS.tribuna),
      sector:           pick(row, ALIAS.sector)
    };
    return (obj.rut || obj.rut_comprador) ? obj : null;
  }).filter(Boolean);

  return rows;
}

const store = getStore({
  name: 'welcome-packs',
  siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
  token: process.env.BLOBS_TOKEN
});

function parseCSV(text){
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g,'');
  const lines = clean.split('\n').filter(Boolean);
  if(!lines.length) return {headers:[],rows:[],delim:','};
  const delim = lines[0].includes(';')?';':',';
  const headers = lines[0].split(delim).map(h=>h.trim());
  const rows = lines.slice(1).map(l=>{
    const c = l.split(delim); const o={}; headers.forEach((h,i)=> o[h] = (c[i]??'').trim()); return o;
  });
  return {headers,rows,delim};
}
function toCSV(headers, rows, delim=','){
  const head = headers.join(delim);
  const body = rows.map(r=> headers.map(h=> r[h]??'').join(delim)).join('\n');
  return head + (rows.length?'\n':'') + body;
}
async function readLog(){
  const txt = (await store.get('registro_entregas.csv')) || '';
  if(!txt.trim()){
    return {
      headers: [
        'rut','nombre','categoria','tribuna','sector',
        'rut_comprador','nombre_comprador',
        'rut_receptor','receptor_nombre','retirado_at'
      ],
      rows: [], delim: ','
    };
  }
  const parsed = parseCSV(txt);
  const headers = [
    'rut','nombre','categoria','tribuna','sector',
    'rut_comprador','nombre_comprador',
    'rut_receptor','receptor_nombre','retirado_at'
  ];
  const rows = parsed.rows.map(r=>{ const o={}; headers.forEach(h=> o[h]=r[h]??''); return o; });
  return {headers, rows, delim: parsed.delim||','};
}

export async function handler(event){
  try{
    if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    const body = JSON.parse(event.body||'{}');
    const rutBusqueda   = normRut(body.rut_busqueda||'');
    const rutReceptor   = normRut(body.receptor_rut||'');
    const nombreReceptor= (body.receptor_nombre||'').trim();
    if(!rutBusqueda || !rutReceptor || !nombreReceptor){
      return { statusCode: 400, body: JSON.stringify({ ok:false, error:'Campos incompletos' }) };
    }

    const base = await readBase();
    const any  = base.find(r=> r.rut===rutBusqueda || r.rut_comprador===rutBusqueda);
    if(!any) return { statusCode: 200, body: JSON.stringify({ ok:false, error:'RUT no está en la base' }) };

    const grupo = base.filter(r=> r.rut_comprador === any.rut_comprador);

    // Validar receptor pertenece al grupo
    const receptorEnGrupo = grupo.some(m=> m.rut === rutReceptor);
    if(!receptorEnGrupo){
      return { statusCode: 200, body: JSON.stringify({ ok:false, error: 'El RUT ingresado no corresponde a este abono' }) };
    }

    // ¿Ya entregado completamente?
    const log = await readLog();
    const ya  = log.rows.filter(r=> r.rut_comprador === any.rut_comprador);
    if(ya.length >= grupo.length){
      return { statusCode: 200, body: JSON.stringify({ ok:false, error:'Welcome packs ya fueron entregados para este grupo' }) };
    }

    // Registrar entrega TOTAL
    const now = new Date().toISOString();
    const nuevas = grupo.map(m=>({
      rut: m.rut,
      nombre: m.nombre,
      categoria: m.categoria,
      tribuna: m.tribuna,
      sector: m.sector,
      rut_comprador: any.rut_comprador,
      nombre_comprador: any.nombre_comprador,
      rut_receptor: rutReceptor,
      receptor_nombre: nombreReceptor,
      retirado_at: now
    }));
    const allRows = [...log.rows, ...nuevas];
    const csv = toCSV(log.headers, allRows, log.delim);
    await store.set('registro_entregas.csv', csv, { addRandomSuffix:false });

    return { statusCode: 200, body: JSON.stringify({ ok:true, entregados: nuevas.length }) };
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: err.message }) };
  }
}
