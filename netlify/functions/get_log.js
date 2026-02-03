// netlify/functions/get_log.js
const { json, readAllLogs } = require("./_log_utils");

exports.handler = async () => {
  try {
    const logs = await readAllLogs(5000);
    return json(200, { status: "OK", total: logs.length, items: logs });
  } catch (e) {
    return json(500, { status: "ERROR", error: String(e?.message || e) });
  }
};
