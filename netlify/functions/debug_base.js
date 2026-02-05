// netlify/functions/debug_base.js
const { json, okCors } = require("./_log_utils");

// --- CSV parser simple con soporte de comillas ---
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
      rows.push(row.map(x => String(x ?? "").trim()));
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row.map(x => String(x ?? "").trim()));
  }

  return rows.filter(r => r.some(c => String(c || "").trim() !== ""));
}

function cleanHeader(h) {
  return String(h || "")
    .replace(/^\uFEFF/, "")       // BOM
    .replace(/\s+/g, " ")
    .trim();
}

function guessDelimiter(text) {
  // mira la primera línea y cuenta ; vs ,
  const firstLine = String(text || "").split(/\r?\n/)[0] || "";
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  // Si hay empate, prioriza ;
  return semi >= comma ? ";" : ",";
}

async function fetchWithDiag(url) {
  const u = String(url || "").trim();
  if (!u) {
    return {
      ok: false,
      status: 0,
      error: "BASE_CSV_URL vacío o no definido",
      used_url: u,
    };
  }

  let res;
  try {
    res = await fetch(u, { redirect: "follow" });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: `Fetch falló: ${String(e?.message || e)}`,
      used_url: u,
    };
  }

  const finalUrl = res.url;
  const status = res.status;
  const headers = {};
  try {
    res.headers.forEach((v, k) => { headers[k] = v; });
  } catch (_) {}

  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch (_) {
    bodyText = "";
  }

  return {
    ok: res.ok,
    status,
    used_url: u,
    final_url: finalUrl,
    headers,
    body_preview_300: bodyText.slice(0, 300),
    body_len: bodyText.length,
    bodyText,
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return okCors();
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    // 1) Leer env var
    const baseUrlRaw = process.env.BASE_CSV_URL || "";
    const baseUrl = String(baseUrlRaw).trim();

    // 2) Fetch + diagnóstico
    const diag = await fetchWithDiag(baseUrl);
    if (!diag.ok) {
      return json(200, {
        ok: false,
        error: diag.error || `HTTP ${diag.status}`,
        base_csv_url_env_raw: baseUrlRaw,
        base_csv_url_used: diag.used_url,
        status: diag.status,
        final_url: diag.final_url || null,
        headers: diag.headers || {},
        preview: diag.body_preview_300 || "",
      });
    }

    const csvText = diag.bodyText || "";

    // 3) Delimiter guess + parse
    const delim = guessDelimiter(csvText);
    const rows = parseCsv(csvText, delim);

    const headers = (rows[0] || []).map(cleanHeader);
    const sampleRows = rows.slice(1, 6);

    // 4) Conteos y checks
    const headerLower = headers.map(h => h.toLowerCase());
    const hasRut = headerLower.includes("rut");
    const hasRutComprador = headerLower.includes("rut comprador") || headerLower.includes("rut_comprador");
    const hasPack = headerLower.includes("pack");
    const hasSector = headerLower.includes("sector");
    const hasCategoria = headerLower.includes("categoria");

    return json(200, {
      ok: true,
      base_csv_url_env_raw: baseUrlRaw,
      base_csv_url_used: diag.used_url,
      final_url: diag.final_url,
      http_status: diag.status,
      content_type: diag.headers?.["content-type"] || null,
      delimiter_detected: delim,
      total_rows: rows.length,          // incluye header
      total_data_rows: Math.max(0, rows.length - 1),
      headers,
      header_checks: {
        hasRut,
        hasRutComprador,
        hasPack,
        hasSector,
        hasCategoria
      },
      sample_rows: sampleRows,
      body_preview_300: diag.body_preview_300,
    });

  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
};
