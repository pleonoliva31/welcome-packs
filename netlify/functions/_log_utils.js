// netlify/functions/_log_utils.js

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

/**
 * Normaliza RUT:
 * - acepta con/sin puntos y con/sin guión
 * - devuelve formato: 12345678-9 o 12345678-K
 */
function normalizeRut(input) {
  if (!input) return "";
  let s = String(input).trim().toUpperCase();
  s = s.replace(/\./g, "").replace(/\s+/g, "");

  // deja solo 0-9, K y -
  s = s.replace(/[^0-9K-]/g, "");

  if (!s) return "";

  if (s.includes("-")) {
    const [body, dv] = s.split("-");
    if (!body || !dv) return "";
    return `${body.replace(/^0+/, "")}-${dv}`;
  }

  // sin guión -> último char es DV
  if (s.length < 2) return "";
  const dv = s.slice(-1);
  const body = s.slice(0, -1);
  return `${body.replace(/^0+/, "")}-${dv}`;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { json, normalizeRut, nowIso };
