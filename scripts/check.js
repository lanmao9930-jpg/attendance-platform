const fs = require("node:fs");
const path = require("node:path");

const files = [
  "local-server.js",
  "api/[...path].js",
  "api/admin-login.js",
  "api/admin-logout.js",
  "api/admin-me.js",
  "api/admin-storage.js",
  "api/checkins.js",
  "api/current-qr.js",
  "api/export.js",
  "api/health.js",
  "api/open-checkin.js",
  "api/options.js",
  "api/qr-svg.js",
  "api/summary.js",
  "lib/api.js",
  "lib/attendance.js",
  "lib/constants.js",
  "lib/http.js",
  "lib/qr.js",
  "lib/security.js",
  "lib/store.js",
  "lib/url.js",
  "lib/vercel-handler.js",
  "public/admin.js",
  "public/display.js",
  "public/student.js"
];

for (const file of files) {
  const fullPath = path.join(__dirname, "..", file);
  new Function(fs.readFileSync(fullPath, "utf8"));
}

console.log("Syntax check passed.");
