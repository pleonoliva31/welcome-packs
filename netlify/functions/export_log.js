const { okCors } = require("./_log_utils");
const blobs = require("@netlify/blobs");

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Falta BLOBS_SITE_ID o BLOBS_TOKEN.");
  if (typeof blobs.getStore === "function") return blobs.getStore({ name: "welcome-packs", siteID, token });
  if (typeof blobs.createClient === "function") return blobs.createClient({ siteID, token }).getStore("welcome-packs");
  throw new Error("No se pudo inicializar Blobs.");
}

function csvToHtmlTableComma(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return "<table></table>";
  const rows = lines.map(l => l.split(",").map(x => x.trim()));
  const head = rows[0];
  const body = rows.slice(1);
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  let html = "<table border='1'><thead><tr>";
  head.forEach(h => html += `<th>${esc(h)}</th>`);
  html += "</tr></thead><tbody>";
  body.forEach(r => {
    html += "<tr>";
    head.forEach((_,i) => html += `<td>${esc(r[i] ?? "")}</td>`);
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();
  try {
    const store = getStore();
    const txt = (await store.get("registro_entregas.csv", { type:"text" })) || "";
    const table = csvToHtmlTableComma(txt);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": 'attachment; filename="registro_entregas.xls"',
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${table}</body></html>`
    };
  } catch (e) {
    return { statusCode: 500, headers: { "content-type":"text/plain; charset=utf-8" }, body: String(e?.message || e) };
  }
};
