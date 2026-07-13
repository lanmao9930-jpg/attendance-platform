const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { handleApi } = require("./lib/api");

const PORT = Number(process.env.PORT || 8788);
const PUBLIC_DIR = path.join(__dirname, "public");

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  }[ext] || "application/octet-stream";
}

async function serveStatic(res, url) {
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/display") pathname = "/display.html";
  if (pathname === "/student") pathname = "/student.html";
  if (pathname === "/admin") pathname = "/admin.html";

  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  try {
    const content = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": mimeType(file), "Cache-Control": "no-store" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(res, url);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, reason: error.message || "服务器错误" }));
  }
});

server.listen(PORT, () => {
  console.log(`Vercel-ready attendance platform running at http://localhost:${PORT}`);
});
