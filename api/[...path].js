const { handleApi } = require("../lib/api");

module.exports = async function handler(req, res) {
  try {
    await handleApi(req, res);
  } catch (error) {
    console.error(error);
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ ok: false, reason: error.message || "服务器错误" }));
  }
};
