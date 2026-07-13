const fs = require("node:fs");
const path = require("node:path");

const files = [
  "local-server.js",
  "api/[...path].js",
  "lib/api.js",
  "lib/attendance.js",
  "lib/constants.js",
  "lib/http.js",
  "lib/qr.js",
  "lib/security.js",
  "lib/store.js",
  "lib/url.js",
  "public/admin.js",
  "public/display.js",
  "public/student.js"
];

for (const file of files) {
  const fullPath = path.join(__dirname, "..", file);
  new Function(fs.readFileSync(fullPath, "utf8"));
}

console.log("Syntax check passed.");
