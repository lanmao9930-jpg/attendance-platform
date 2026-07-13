const os = require("node:os");

function publicOrigin(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;

  const host = String(req.headers.host || "localhost:8788");
  const parsed = parseHost(host);
  const hostname = parsed.hostname;
  const port = parsed.port || "8788";
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return `http://${host}`;
  }
  const lanIp = firstLanIpv4();
  return `http://${lanIp || "localhost"}:${port}`;
}

function parseHost(host) {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return {
      hostname: host.slice(1, end),
      port: host.slice(end + 2)
    };
  }
  const [hostname, port] = host.split(":");
  return { hostname, port };
}

function firstLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "";
}

module.exports = {
  publicOrigin
};
