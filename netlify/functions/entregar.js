// netlify/functions/entregar.js
import { json, normalizeRut, getStores } from "./_log_utils.js";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { status: "ERROR", error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");

    const group_key = String(body.group_key || "").trim();
    const rut_receptor = normalizeRut(body.rut_receptor || "");
    const nombre_receptor = String(body.nombre_receptor || "").trim();

    if (!group_key) return json(400, { status: "ERROR", error: "Falta group_key" });
    if (!rut_receptor || !nombre_receptor) {
      return json(400, { status: "ERROR", error: "Faltan datos del receptor" });
    }

    const { logStore } = await getStores();
    const logRaw = (await logStore.get("log.json"))?.toString?.() || "";
    const log = logRaw ? JSON.parse(logRaw) : [];

    if (log.some((x) => String(x.group_key) === group_key)) {
      return json(200, { status: "YA_ENTREGADO" });
    }

    log.unshift({
      group_key,
      rut_receptor,
      nombre_receptor,
      ts: new Date().toISOString(),
    });

    await logStore.set("log.json", JSON.stringify(log));

    return json(200, { status: "OK" });
  } catch (e) {
    return json(200, { status: "ERROR", error: String(e?.message || e) });
  }
};
