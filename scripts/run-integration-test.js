const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
const port = 18000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "attendance-platform-test-"));
const env = {
  ...process.env,
  PORT: String(port),
  PUBLIC_BASE_URL: baseUrl,
  ADMIN_PASSWORD: "12345678",
  QR_SECRET: "local-test-secret-12345678901234567890",
  DISPLAY_TOKEN: "display-test-key",
  ATTENDANCE_DATA_DIR: dataDir,
  TEST_BASE_URL: baseUrl
};

const server = spawn(process.execPath, ["--require", "./scripts/test-clock.js", "local-server.js"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local server did not become ready.\n${serverLog}`);
}

function runIntegration() {
  return new Promise((resolve, reject) => {
    const test = spawn(process.execPath, ["scripts/integration-test.js"], {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true
    });
    test.on("error", reject);
    test.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Integration test exited with code ${code}`));
    });
  });
}

(async () => {
  try {
    await waitUntilReady();
    await runIntegration();
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
