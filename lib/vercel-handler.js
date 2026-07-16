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

function createHandler(pathname) {
  return async (req, res) => {
    const source = String(req.url || "");
    const queryIndex = source.indexOf("?");
    const query = queryIndex >= 0 ? source.slice(queryIndex) : "";
    req.url = `${pathname}${query}`;
    return run(req, res);
  };
}

module.exports = {
  createHandler,
  run
};
