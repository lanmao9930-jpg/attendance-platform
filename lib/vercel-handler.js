const { handleApi } = require("./api");

async function run(req, res) {
  try {
    await handleApi(req, res);
  } catch (error) {
    console.error(error);
    if (res.headersSent) return;
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ ok: false, reason: error.message || "Server error" }));
  }
}

module.exports = {
  run
};
