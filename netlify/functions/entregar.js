// netlify/functions/entregar.js

import { getStore } from "@netlify/blobs";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method Not Allowed",
      };
    }

    const body = JSON.parse(event.body || "{}");

    const {
      rut_buscado,
      rut_receptor,
      nombre_receptor,
    } = body;

    if (!rut_buscado) {
      return json(400, { error: "Falta rut_buscado" });
    }

    if (!rut_receptor || !nombre_receptor) {
      return json(400, { error: "Faltan datos del receptor" });
    }

    // Conectar a Blobs
    const store = getStore("welcome-packs");

    const key = "registro_entregas.csv";

    // Leer archivo actual (si existe)
    let actual = "";

    try {
      actual = await store.get(key, { type: "text" });
    } catch {
      actual = "fecha,rut_buscado,rut_receptor,nombre_receptor\n";
    }

    const now = new Date().toISOString();

    const nuevaLinea = `${now},${rut_buscado},${rut_receptor},${nombre_receptor}\n`;

    const nuevo = actual + nuevaLinea;

    await store.set(key, nuevo);

    return json(200, {
      status: "OK",
      message: "Entrega registrada",
    });

  } catch (err) {
    return json(500, {
      error: String(err?.message || err),
    });
  }
};

function json(code, obj) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(obj),
  };
}
