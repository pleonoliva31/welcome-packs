import { getStore } from '@netlify/blobs';

const store = getStore({
  name: 'welcome-packs',
  siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
  token: process.env.BLOBS_TOKEN
});

function parseCSV(text){
  const clean=text.replace(/^\uFEFF/,'').replace(/\r/g,'');
  const lines=clean.split('\n').filter(Boolean);
  if(!lines.length) return {headers:[], rows:[]};
  const delim=lines[0].includes(';')?';':',';
  const headers=lines[0].split(delim).map(h=>h.trim());
  const rows=lines.slice(1).map(l=>{
    const c=l.split(delim); const o={}; headers.forEach((h,i)=>o[h]=c[i]?.trim()??''); return o;
  });
  return {headers, rows};
}

const normRut = s => (s||'').toUpperCase().replace(/[.\-]/g,'').trim();

export async function handler(){
  try{
    const txt=(await store.get('registro_entregas.csv'))||'';
    if(!txt.trim()) return {statusCode:200, headers:{'Content-Type':'application/json'}, body:'[]'};

    const {rows}=parseCSV(txt);
    const mapRow = r => ({
      rut: r.rut || r.RUT || '',
      nombre: r.nombre || r.NOMBRE || '',
      categoria: (r.categoria || r.CATEGORIA || '').toUpperCase(),
      rut_comprador: normRut(r.rut_comprador || r.RUT_COMPRADOR || ''),
      nombre_comprador: r.nombre_comprador || r.NOMBRE_COMPRADOR || '',
      rut_receptor: normRut(r.rut_receptor || r.RUT_RECEPTOR || ''),
      receptor_nombre: r.receptor_nombre || r.RECEPTOR_NOMBRE || '',
      retirado_at: r.retirado_at || r.RETIRADO_AT || ''
    });
    const clean = rows.map(mapRow).filter(r=> r.rut_comprador);

    const groups = {};
    for(const r of clean){
      const key = r.rut_comprador;
      if(!groups[key]){
        groups[key] = {
          rut_comprador: r.rut_comprador,
          nombre_comprador: r.nombre_comprador,
          rut_receptor: r.rut_receptor,
          nombre_receptor: r.receptor_nombre,
          total_packs: 0,
          detalle: {}
        };
      }
      groups[key].total_packs += 1;
      const cat = r.categoria || 'ESTANDAR';
      groups[key].detalle[cat] = (groups[key].detalle[cat]||0) + 1;

      if(r.retirado_at && r.receptor_nombre){
        groups[key].rut_receptor = r.rut_receptor || groups[key].rut_receptor;
        groups[key].nombre_receptor = r.receptor_nombre || groups[key].nombre_receptor;
      }
    }

    const out = Object.values(groups).map(g=>{
      const detalleArr = Object.entries(g.detalle).map(([cat,cantidad])=>({cat, cantidad}));
      const detalleTexto = detalleArr.map(d=>`${d.cantidad} ${d.cat}`).join(' · ');
      return {
        nombre_receptor: g.nombre_receptor || '',
        rut_receptor: g.rut_receptor || '',
        nombre_comprador: g.nombre_comprador || '',
        rut_comprador: g.rut_comprador || '',
        total_packs: g.total_packs,
        detalle: detalleArr,
        detalle_texto: detalleTexto
      };
    });

    out.sort((a,b)=> (a.rut_comprador > b.rut_comprador ? 1 : -1));

    return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify(out) };
  }catch(e){
    return { statusCode:500, body: JSON.stringify({error:e.message}) };
  }
}
