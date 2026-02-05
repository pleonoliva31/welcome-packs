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

function normalizeRut(rut) {
  const s = String(rut || "").trim().toUpperCase();
  if (!s) return "";
  // quita puntos y espacios, deja guión si existe
  const cleaned = s.replace(/\./g, "").replace(/\s+/g, "");
  return cleaned;
}

function formatRut(rut) {
  const s = normalizeRut(rut);
  if (!s) return "";
  // deja como viene (ya vienes usando formatRut en buscar)
  return s;
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
