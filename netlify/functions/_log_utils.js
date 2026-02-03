// netlify/functions/_log_utils.js  (ESM)

export function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(data),
  };
}

export function normalizeRut(input) {
  if (!input) return "";
  // quita puntos/espacios, deja guion opcional, y mayúscula K
  let s = String(input).trim().toUpperCase();
  s = s.replace(/\./g, "");
  s = s.replace(/\s+/g, "");

  // si viene con guion, normaliza: XXXXXXXX-Y
  // si viene sin guion, lo dejamos tal cual (pero sin caracteres raros)
  s = s.replace(/[^0-9K-]/g, "");

  // si tiene más de un guion, lo arreglamos
  const parts = s.split("-").filter(Boolean);
  if (parts.length === 1) return parts[0];
  return `${parts[0]}-${parts[1]}`;
}
