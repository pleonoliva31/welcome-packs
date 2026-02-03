// netlify/functions/_log_utils.js (CommonJS)

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(bodyObj),
  };
}

function okCors() {
  return {
    statusCode: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: "",
  };
}

// Normaliza: quita puntos y guiones. Ej: 18.465.371-0 -> 184653710 ; 21599273-K -> 21599273K
function normalizeRut(rut) {
  if (!rut) return "";
  const r = String(rut)
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/-/g, "");

  if (r.length < 2) return "";
  return r;
}

// Formatea: 184653710 -> 18465371-0
function formatRut(rutAny) {
  const r = normalizeRut(rutAny);
  if (!r || r.length < 2) return "";
  const cuerpo = r.slice(0, -1);
  const dv = r.slice(-1);
  return `${cuerpo}-${dv}`;
}

// Fecha/hora “Chile” simple (UTC-3). Si quieres DST después lo ajustamos.
function nowIsoChile() {
  const d = new Date();
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const chileMs = utcMs - 3 * 60 * 60000;
  const c = new Date(chileMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())} ${pad(
    c.getHours()
  )}:${pad(c.getMinutes())}:${pad(c.getSeconds())}`;
}

module.exports = { json, okCors, normalizeRut, formatRut, nowIsoChile };
