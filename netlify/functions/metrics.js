// netlify/functions/metrics.js
import { getStore } from '@netlify/blobs';

const store = getStore({
  name:'welcome-packs',
  siteID:process.env.BLOBS_SITE_ID||process.env.SITE_ID,
  token:process.env.BLOBS_TOKEN
});

const norm = s=>(s||'').toUpperCase().replace(/[.\-]/g,'').trim();
function parseCSV(text){
  const clean=text.replace(/^\uFEFF/,'').replace(/\r/g,'');
  const lines=clean.split('\n').filter(Boolean);
  if(!lines.length) return{headers:[],rows:[]};
  const delim=lines[0].includes(';')?';':',';
  const headers=lines[0].split(delim).map(h=>h.trim());
  const rows=lines.slice(1).map(l=>{
    const c=l.split(delim);const o={};headers.forEach((h,i)=>o[h]=c[i]?.trim()??'');return o;
  });
  return{headers,rows};
}

async function readBase(){
  const url=process.env.BASE_CSV_URL;
  const txt=await(await fetch(url)).text();
  return parseCSV(txt).rows;
}
async function readLog(){
  const txt=(await store.get('registro_entregas.csv'))||'';
  if(!txt.trim()) return [];
  return parseCSV(txt).rows;
}

export async function handler(){
  try{
    const base=await readBase();
    const log=await readLog();
    const total=base.length;
    const entregados=new Set(log.map(r=>norm(r.rut))).size;

    // por categoría
    const cats={};
    base.forEach(r=>{
      const cat=(r['Welcome Pack']||r['categoria']||'').toUpperCase();
      cats[cat]=cats[cat]||{total:0,entregados:0};
      cats[cat].total++;
    });
    log.forEach(r=>{
      const cat=(r['categoria']||'').toUpperCase();
      if(cats[cat]) cats[cat].entregados++;
    });
    const categorias=Object.entries(cats).map(([cat,v])=>({
      cat,total:v.total,entregados:v.entregados,porc:((v.entregados/v.total*100)||0).toFixed(1)
    }));

    // por tribuna
    const tribs={};
    base.forEach(r=>{
      const t=(r['Tribuna']||r['tribuna']||'').toUpperCase();
      tribs[t]=tribs[t]||{total:0,entregados:0};
      tribs[t].total++;
    });
    log.forEach(r=>{
      const t=(r['tribuna']||'').toUpperCase();
      if(tribs[t]) tribs[t].entregados++;
    });
    const tribunas=Object.entries(tribs).map(([t,v])=>({
      tribuna:t,total:v.total,entregados:v.entregados,porc:((v.entregados/v.total*100)||0).toFixed(1)
    }));

    return {statusCode:200, body:JSON.stringify({
      total, entregados, porc_total:((entregados/total*100)||0).toFixed(1),
      categorias, tribunas
    })};
  }catch(e){return{statusCode:500,body:e.message};}
}
