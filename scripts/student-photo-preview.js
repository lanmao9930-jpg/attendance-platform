const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 8792);

if (!process.argv.includes("--serve")) {
  const child = spawn(process.execPath, [__filename, "--serve"], { cwd: root, detached: true, windowsHide: true, stdio: "ignore", env: process.env });
  child.unref();
  console.log(`Local photo test: http://127.0.0.1:${port}/student?token=test (PID ${child.pid})`);
} else {
  const { centers, studentPositions, dutyTypes, weeks, weekdays, shifts } = require("../lib/constants");
  const { DEFAULT_CALENDAR, calendarContext } = require("../lib/calendar");
  let result = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const json = data => { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
    if (url.pathname === "/api/open-checkin") return json({ session: "local-test", options: { centers, positions: studentPositions, dutyTypes, weeks, weekdays, shifts } });
    if (url.pathname === "/api/calendar") return json({ calendar: calendarContext(DEFAULT_CALENDAR, "2026-09-08T08:32:00Z") });
    if (url.pathname === "/api/checkins") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      result = { shifts: data.shifts, attendanceType: data.attendanceType, photoName: data.photoName, photoPrefix: data.photoDataUrl.slice(0, 30) };
      return json({ ok: true });
    }
    if (url.pathname === "/__test/result") return json(result);
    if (url.pathname === "/fault-image.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      return res.end('window.Image = class { set src(value) { if(value) setTimeout(() => this.onerror && this.onerror(new Event("error")), 0); } };');
    }
    if (url.pathname === "/student") {
      let html = fs.readFileSync(path.join(root, "public", "student.html"), "utf8");
      if (url.searchParams.get("scenario") === "decode-error") html = html.replace('<script src="/student.js', '<script src="/fault-image.js"></script><script src="/student.js');
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }
    if (["/student.js", "/styles.css"].includes(url.pathname)) {
      res.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "application/javascript" : "text/css", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(path.join(root, "public", url.pathname.slice(1))));
    }
    res.writeHead(404); res.end();
  });
  server.listen(port, "127.0.0.1");
}
