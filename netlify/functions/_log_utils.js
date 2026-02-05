// netlify/functions/_log_utils.js

function okCors() {
  return {
    statusCode: 200,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: "",
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(obj),
  };
}

/**
 * Normaliza a formato canónico SIN guión:
 * - deja solo dígitos + K
 * - toma último char como DV
 * - retorna "CUERPO+DV" (ej: 184653710)
 */
function normalizeRut(rut) {
  let s = String(rut || "")
    .toUpperCase()
    .trim()
    .replace(/\./g, "")
    .replace(/\s+/g, "");

  // deja solo [0-9K]
  s = s.replace(/[^0-9K]/g, "");

  if (s.length < 2) return "";

  const dv = s.slice(-1);
  let body = s.slice(0, -1);

  // quita ceros a la izquierda
  body = body.replace(/^0+/, "");
  if (!body) return "";

  return body + dv;
}

/**
 * Formatea para mostrar: con guión (y opcionalmente puntos).
 * Por defecto: sin puntos, con guión.
 */
function formatRut(rut, withDots = false) {
  const n = normalizeRut(rut);
  if (!n) return "";

  const dv = n.slice(-1);
  let body = n.slice(0, -1);

  if (!withDots) return `${body}-${dv}`;

  // agrega puntos a cuerpo
  let out = "";
  while (body.length > 3) {
    out = "." + body.slice(-3) + out;
    body = body.slice(0, -3);
  }
  out = body + out;

  return `${out}-${dv}`;
}

function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ISO “Chile” fijo -03:00 (sin depender de timezone del server)
function nowChileISO() {
  const offsetMs = 3 * 60 * 60 * 1000;
  const d = new Date(Date.now() - offsetMs); // “corremos” la hora para que el UTC sea Chile
  const pad = (n) => String(n).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  const yyyy = d.getUTCFullYear();
  const MM = pad(d.getUTCMonth() + 1);
  const DD = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}-${MM}-${DD}T${hh}:${mm}:${ss}.${ms}-03:00`;
}

module.exports = {
  okCors,
  json,
  normalizeRut,
  formatRut,
  stripDiacritics,
  nowChileISO,
};
