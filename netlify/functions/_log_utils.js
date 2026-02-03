// netlify/functions/_log_utils.js
function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(obj),
  };
}

// Normaliza RUT: quita puntos/espacios, deja guión antes del DV y DV en MAYÚSCULA
function normalizeRut(input) {
  if (!input) return "";
  let s = String(input).trim().toUpperCase();
  s = s.replace(/\./g, "").replace(/\s+/g, "");

  // si viene con guión, ok
  if (s.includes("-")) {
    const [num, dv] = s.split("-");
    if (!num || !dv) return "";
    return `${num.replace(/\D/g, "")}-${dv.replace(/[^0-9K]/g, "")}`;
  }

  // si viene sin guión: último char es DV
  const clean = s.replace(/[^0-9K]/g, "");
  if (clean.length < 2) return "";
  const num = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${num}-${dv}`;
}

function nowISO() {
  return new Date().toISOString();
}

module.exports = { json, normalizeRut, nowISO };
