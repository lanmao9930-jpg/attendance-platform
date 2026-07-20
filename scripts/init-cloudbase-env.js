const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "..", ".env.local");
const adminPassword = String(process.env.CLOUDBASE_ADMIN_PASSWORD || "").trim();

if (!adminPassword) {
  throw new Error("CLOUDBASE_ADMIN_PASSWORD is required");
}

if (!fs.existsSync(target)) {
  const qrSecret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(target, `ADMIN_PASSWORD=${adminPassword}\nQR_SECRET=${qrSecret}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

console.log("CloudBase local deployment secrets are ready.");
