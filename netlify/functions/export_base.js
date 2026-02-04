const { okCors } = require("./_log_utils");

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar CSV. HTTP ${res.status}`);
  return await res.text();
}

function csvToHtmlTableSemicolon(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return "<table></table>";
  const rows = lines.map(l => l.split(";").map(x => x.trim()));
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
    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) throw new Error("Falta BASE_CSV_URL");

    const csv = await loadCsv(baseUrl);
    const table = csvToHtmlTableSemicolon(csv);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": 'attachment; filename="base_welcome_packs.xls"',
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${table}</body></html>`
    };
  } catch (e) {
    return { statusCode: 500, headers: { "content-type":"text/plain; charset=utf-8" }, body: String(e?.message || e) };
  }
};
