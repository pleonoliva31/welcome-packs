// netlify/functions/get_log.js
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

    const pageSize = Math.min(parseInt(event.queryStringParameters?.limit || "50", 10), 200);
    const cursor = event.queryStringParameters?.cursor || undefined;

    const res = await store.list({ cursor, limit: pageSize });

    // res.blobs = [{ key, size, etag, last_modified }]
    // ahora leemos cada registro (simple; para muchas filas luego optimizamos)
    const items = [];
    for (const b of res.blobs) {
      const raw = await store.get(b.key);
      if (!raw) continue;
      const obj = JSON.parse(raw);
      items.push(obj);
    }

    // orden por updated_at desc
    items.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

    return json(200, {
      status: "OK",
      items,
      next_cursor: res.next_cursor || null,
    });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
