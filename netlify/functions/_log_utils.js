// netlify/functions/_log_utils.js
export async function getStores() {
  const { getStore } = await import("@netlify/blobs");
  const logStore = getStore("welcome_log");
  return { logStore };
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}

export function normalizeRut(input = "") {
  return String(input)
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/—/g, "-");
}

export async function fetchCsvText(url) {
  if (!url) throw new Error("BASE_CSV_URL no configurada");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`No pude descargar CSV (${res.status})`);
  return await res.text();
}

export function parseCsvSemicolon(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return { headers: [], rows: [] };

  const headers = lines[0].split(";").map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = (cols[j] ?? "").trim();
    rows.push(obj);
  }
  return { headers, rows };
}
