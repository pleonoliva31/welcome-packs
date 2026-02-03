// netlify/functions/_log_utils.js
const { getStore } = require("@netlify/blobs");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function normalizeRut(input) {
  if (!input) return "";
  // Quitar puntos, espacios, guión y dejar DV en mayúscula
  const s = String(input).trim().toUpperCase().replace(/\./g, "").replace(/-/g, "").replace(/\s+/g, "");
  return s;
}

function ensureEnv() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) {
    throw new Error("Faltan variables BLOBS_SITE_ID o BLOBS_TOKEN en Netlify.");
  }
  return { siteID, token };
}

function getLogStore() {
  const { siteID, token } = ensureEnv();
  // Nombre del store (puede ser cualquiera, mantén este fijo)
  return getStore({ name: "welcomepack-log", siteID, token });
}

// Guarda un evento en el log (append)
async function appendLog(entry) {
  const store = getLogStore();
  const key = `log:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  await store.setJSON(key, entry);
  return key;
}

// Lee todos los eventos del log (ordenados por fecha)
async function readAllLogs(limit = 5000) {
  const store = getLogStore();
  const list = await store.list({ prefix: "log:" });
  // list.blobs -> [{ key, ... }]
  const keys = (list?.blobs || []).map((b) => b.key);
  // Limitar para no explotar (por si crece mucho)
  const sliced = keys.slice(-limit);

  const items = [];
  for (const k of sliced) {
    const val = await store.getJSON(k);
    if (val) items.push({ key: k, ...val });
  }
  items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return items;
}

module.exports = {
  json,
  normalizeRut,
  appendLog,
  readAllLogs,
};
