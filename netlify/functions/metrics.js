// netlify/functions/metrics.js
const { json, okCors } = require("./_log_utils");
const { createClient } = require("@netlify/blobs");

function getStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Falta BLOBS_SITE_ID o BLOBS_TOKEN.");
  const client = createClient({ siteID, token });
  return client.getStore("welcome-pack-logs");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return okCors();

  try {
    const store = getStore();
    let totalEntregas = 0;
    let cursor = undefined;

    while (true) {
      const res = await store.list({ cursor, limit: 200 });
      totalEntregas += res.blobs.length;
      if (!res.next_cursor) break;
      cursor = res.next_cursor;
    }

    return json(200, {
      status: "OK",
      total_entregas_grupos: totalEntregas,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
