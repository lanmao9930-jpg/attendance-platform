const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "..", ".env.local");

if (!fs.existsSync(target)) {
  throw new Error(".env.local does not exist; run init-cloudbase-env.js first");
}

const adminPassword = `Duty!${crypto.randomBytes(12).toString("base64url")}`;
const qrSecret = crypto.randomBytes(48).toString("hex");

fs.writeFileSync(target, `ADMIN_PASSWORD=${adminPassword}\nQR_SECRET=${qrSecret}\n`, {
  encoding: "utf8",
  mode: 0o600
});

console.log(`New admin password: ${adminPassword}`);
console.log("QR signing secret rotated without being displayed.");
