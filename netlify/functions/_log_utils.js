// netlify/functions/_log_utils.js

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

// Calcula DV de RUT chileno (módulo 11)
function calcDv(rutBodyDigits) {
  let rut = String(rutBodyDigits).replace(/\D/g, "");
  let sum = 0;
  let mul = 2;
  for (let i = rut.length - 1; i >= 0; i--) {
    sum += parseInt(rut[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return "0";
  if (res === 10) return "K";
  return String(res);
}

// Devuelve formato CANÓNICO: "XXXXXXXX-X"
// Acepta:
// - con/sin puntos
// - con/sin guión
// - con DV o sin DV (si falta DV, lo calcula)
function normalizeRut(input) {
  if (!input) return "";

  let s = String(input).trim().toUpperCase();
  // Quitar espacios y puntos
  s = s.replace(/\./g, "").replace(/\s+/g, "");

  // Caso con guión
  if (s.includes("-")) {
    const [bodyRaw, dvRaw] = s.split("-");
    const body = (bodyRaw || "").replace(/\D/g, "");
    let dv = (dvRaw || "").replace(/[^0-9K]/g, "");
    if (!body) return "";
    if (!dv) dv = calcDv(body);
    return `${body}-${dv}`;
  }

  // Caso sin guión:
  // - Si termina en K o dígito y el resto son dígitos => lo interpretamos como "cuerpo+dv"
  //   ejemplo: "184653710" => cuerpo "18465371", dv "0"
  const only = s.replace(/[^0-9K]/g, "");

  if (!only) return "";

  // Si viene con DV pegado (último char K o dígito) y el cuerpo queda 7-8 dígitos
  const last = only.slice(-1);
  const bodyCandidate = only.slice(0, -1);

  if (/^[0-9]+$/.test(bodyCandidate) && /^[0-9K]$/.test(last) && bodyCandidate.length >= 7 && bodyCandidate.length <= 8) {
    return `${bodyCandidate}-${last}`;
  }

  // Si viene solo cuerpo numérico (7-8 dígitos) => calculamos DV
  if (/^[0-9]+$/.test(only) && only.length >= 7 && only.length <= 8) {
    const dv = calcDv(only);
    return `${only}-${dv}`;
  }

  // Si viene raro, intento rescatar cuerpo numérico y calcular
  const body = only.replace(/\D/g, "");
  if (body.length >= 7 && body.length <= 8) {
    const dv = calcDv(body);
    return `${body}-${dv}`;
  }

  return "";
}

// Para comparar ignorando DV (por si quieres usarlo en otros lados)
function rutBody(input) {
  const n = normalizeRut(input);
  if (!n) return "";
  return n.split("-")[0];
}

module.exports = { json, normalizeRut, rutBody };
