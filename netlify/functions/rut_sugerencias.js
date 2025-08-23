// netlify/functions/rut_sugerencias.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    const { rut = "" } = event.queryStringParameters || {};
    const q = normRut(rut);
    if (!q) return json({ ok: true, sugerencias: [] });

    const baseUrl = process.env.BASE_CSV_URL;
    if (!baseUrl) return json({ ok: false, error: "NO_BASE_URL" }, 500);

    // Descarga CSV
    const res = await fetch(baseUrl, { cache: "no-store" });
    if (!res.ok) return json({ ok: false, error: "CSV_FETCH_ERROR" }, 500);
    const csv = await res.text();

    const { rows } = parseCSV(csv);

    // Campos esperados (normalizados)
    const items = rows.map(r => ({
      rut: (r.rut || r.Rut || r.RUT || "").trim(),
      nombre: (r.nombre || r["Nombre Completo"] || r.Nombre || "").trim(),
      rut_comprador: (r.rut_comprador || r["Rut Comprador"] || "").trim(),
      nombre_comprador: (r.nombre_comprador || r["Nombre Comprador"] || "").trim(),
    })).filter(x => x.rut);

    // Búsqueda rápida: prefijo y distancia <= 2
    const prefQ = q.slice(0, 3);
    const candidates = [];
    for (const it of items) {
      const rt = normRut(it.rut);
      if (!rt) continue;
      if (rt[0] !== q[0]) continue;          // primer dígito igual (filtro agresivo)
      if (rt.slice(0, 3) !== prefQ) continue; // prefijo 3 dígitos
      const d = damerau(q, rt, 2);            // corta si > 2
      if (d <= 2) {
        candidates.push({ ...it, dist: d });
      }
    }

    candidates.sort((a, b) => a.dist - b.dist || a.rut.localeCompare(b.rut));
    const sugerencias = candidates.slice(0, 5).map(x => ({
      rut: x.rut,
      nombre: x.nombre,
      rut_comprador: x.rut_comprador,
      nombre_comprador: x.nombre_comprador
    }));

    return json({ ok: true, sugerencias });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
};

// ---------- Utils ----------
function json(obj, status = 200) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function normRut(s) {
  return (s || "").toUpperCase().replace(/[.\-]/g, "").trim();
}
function parseCSV(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const delim = detectDelim(lines[0]);
  const header = lines[0].split(delim).map(h => normKey(h));
  const rows = lines.slice(1).map(line => {
    const cols = line.split(delim);
    const obj = {};
    header.forEach((h, i) => obj[h] = (cols[i] || "").trim());
    return obj;
  });
  return { header, rows };
}
function detectDelim(header) {
  if (header.indexOf(";") >= 0) return ";";
  if (header.indexOf(",") >= 0) return ",";
  return ";";
}
function normKey(k) {
  return (k || "").toString().toLowerCase()
    .replace(/\s+/g, "_").replace(/[^\w]/g, "").trim();
}
// Damerau–Levenshtein con límite (early exit)
function damerau(a, b, maxDist = 2) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > maxDist) return maxDist + 1;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,           // borrado
        dp[i][j - 1] + 1,           // inserción
        dp[i - 1][j - 1] + cost     // sustitución
      );
      // transposición
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
      rowMin = Math.min(rowMin, dp[i][j]);
    }
    if (rowMin > maxDist) return maxDist + 1; // corte temprano
  }
  return dp[n][m];
}
