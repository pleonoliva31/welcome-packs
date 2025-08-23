// netlify/functions/get_log.js
import { getLog } from "./_log_utils.js";

export const handler = async () => {
  try {
    const rows = await getLog();
    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(rows)
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ error: String(e) })
    };
  }
};
