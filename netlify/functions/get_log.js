// netlify/functions/get_log.js
import { getStore } from '@netlify/blobs';
const store=getStore({
  name:'welcome-packs',
  siteID:process.env.BLOBS_SITE_ID||process.env.SITE_ID,
  token:process.env.BLOBS_TOKEN
});

function parseCSV(text){
  const clean=text.replace(/^\uFEFF/,'').replace(/\r/g,'');
  const lines=clean.split('\n').filter(Boolean);
  if(!lines.length)return{headers:[],rows:[]};
  const delim=lines[0].includes(';')?';':',';
  const headers=lines[0].split(delim).map(h=>h.trim());
  const rows=lines.slice(1).map(l=>{
    const c=l.split(delim);const o={};headers.forEach((h,i)=>o[h]=c[i]?.trim()??'');return o;
  });
  return{headers,rows};
}

export async function handler(){
  try{
    const txt=(await store.get('registro_entregas.csv'))||'';
    if(!txt.trim())return{statusCode:200,body:'[]'};
    const {rows}=parseCSV(txt);
    return {statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify(rows)};
  }catch(e){return{statusCode:500,body:e.message};}
}
