// netlify/functions/export_log.js
const { okCors, stripDiacritics } = require("./_log_utils");
const blobs = require("@netlify/blobs");

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Falta BLOBS_SITE_ID o BLOBS_TOKEN.");
  if (typeof blobs.getStore === "function") return blobs.getStore({ name: "welcome-packs", siteID, token });
  if (typeof blobs.createClient === "function") return blobs.createClient({ siteID, token }).getStore("welcome-packs");
  throw new Error("No se pudo inicializar Blobs.");
}

// parser CSV con comillas (por si hay nombres con coma)
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(cur);
      cur = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  return rows.filter(r => r.some(c => String(c || "").trim() !== ""));
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

function toChileLocalString(iso) {
  const v = String(iso || "").trim();
  if (!v) return "";
  // si ya trae -03:00 lo dejamos
  if (v.includes("-03:00")) return v;
  // si es UTC Z, convertimos
  if (v.endsWith("Z")) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      const dChile = new Date(d.getTime() - 3 * 60 * 60 * 1000);
      // formateo tipo 2026-02-05 11:26:21 (-03)
      const pad = (n) => String(n).padStart(2, "0");
      const yyyy = dChile.getUTCFullYear();
      const MM = pad(dChile.getUTCMonth() + 1);
      const DD = pad(dChile.getUTCDate());
      const hh = pad(dChile.getUTCHours());
      const mm = pad(dChile.getUTCMinutes());
      const ss = pad(dChile.getUTCSeconds());
      return `${yyyy}-${MM}-${DD} ${hh}:${mm}:${ss} (-03)`;
    }
  }
  return v;
}

function csvToHtmlTableCommaWithTZ(csvText) {
  const rows = parseCsv(csvText, ",");
  if (!rows.length) return "<table></table>";

  const head = rows[0].map(h => String(h || "").trim());
  const body = rows.slice(1);

  // detectar columna retirado_at
  const lower = head.map(h => stripDiacritics(h).toLowerCase());
  const idxRet = lower.indexOf("retirado_at");

  let html = "<table border='1'><thead><tr>";
  head.forEach(h => html += `<th>${escHtml(h)}</th>`);
  html += "</tr></thead><tbody>";

  body.forEach(r => {
    html += "<tr>";
    for (let i = 0; i < head.length; i++) {
      let val = (r[i] ?? "").trim();
      if (i === idxRet) val = toChileLocalString(val);
      html += `<td>${escHtml(val)}</td>`;
    }
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
    const table = csvToHtmlTableCommaWithTZ(txt);

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
