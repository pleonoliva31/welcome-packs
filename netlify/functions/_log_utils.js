// netlify/functions/_log_utils.js
import { createClient } from "@netlify/blobs";

const STORE = "entregas_log";

function getStore() {
  const siteId = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  if (!siteId || !token) {
    throw new Error("Faltan BLOBS_SITE_ID o BLOBS_TOKEN en variables de entorno");
  }
  const client = createClient({ siteId, token });
  return client.use(STORE);
}

export async function getLog() {
  const store = getStore();
  const text = await store.get("log.json", { type: "text" });
  if (!text) return [];
  try { return JSON.parse(text); } catch { return []; }
}

export async function putLog(entry) {
  const store = getStore();
  const rows = await getLog();
  rows.unshift(entry);
  await store.set("log.json", JSON.stringify(rows), {
    contentType: "application/json"
  });
}
