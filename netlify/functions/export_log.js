// netlify/functions/export_log.js
const { okCors } = require("./_log_utils");
const blobs = require("@netlify/blobs");

const STORE_NAME = "welcome-packs";
const LOG_KEY = "registro_entregas_2026.csv";

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Falta BLOBS_SITE_ID o BLOBS_TOKEN.");
  if (typeof blobs.getStore === "function") return blobs.getStore({ name: STORE_NAME, siteID, token });
  if (typeof blobs.createClient === "function") return blobs.createClient({ siteID, token }).getStore(STORE_NAME);
  throw new Error("No se pudo inicializar Blobs.");
}

// CSV parser robusto (soporta comillas)
function parseCsv(text, delimiter = ",") {
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
    if (!inQuotes && ch === delimiter) { row.push(cur); cur = ""; continue; }
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
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c || "").trim() !== ""));
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

// Formato Chile: YYYY-MM-DD HH:mm:ss
function formatChile(isoZ) {
  if (!isoZ) return "";
  const d = new Date(isoZ);
  if (isNaN(d.getTime())) return "";

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);

  // sv-SE ya viene tipo: 2026-02-05 11:49:02
  return parts;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();

  try {
    const store = getStore();
    const txt = (await store.get(LOG_KEY, { type:"text" })) || "";

    const rows = parseCsv(txt, ",");
    if (!rows.length) {
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/vnd.ms-excel; charset=utf-8",
          "content-disposition": 'attachment; filename="registro_entregas_2026.xls"',
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        },
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"></table></body></html>`
      };
    }

    const head = rows[0].map(h => String(h || "").trim());
    const body = rows.slice(1);

    const idxRet = head.findIndex(h => h.trim().toLowerCase() === "retirado_at");

    let html = "<table border='1'><thead><tr>";
    head.forEach(h => html += `<th>${escHtml(h)}</th>`);
    html += "</tr></thead><tbody>";

    body.forEach(r => {
      html += "<tr>";
      for (let i = 0; i < head.length; i++) {
        let val = r[i] ?? "";
        // ✅ reemplaza retirado_at por hora Chile (misma columna)
        if (idxRet !== -1 && i === idxRet) val = formatChile(val);
        html += `<td>${escHtml(val)}</td>`;
      }
      html += "</tr>";
    });

    html += "</tbody></table>";

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": 'attachment; filename="registro_entregas_2026.xls"',
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type":"text/plain; charset=utf-8", "access-control-allow-origin":"*" },
      body: String(e?.message || e)
    };
  }
};
