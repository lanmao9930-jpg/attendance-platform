const crypto = require("node:crypto");
const { cookieHeader, json, parseCookies } = require("./http");

const QR_INTERVAL_MS = 5000;
const QR_SCAN_GRACE_SLOTS = 12;
const CHECKIN_SESSION_TTL_MS = 3 * 60 * 1000;
const ADMIN_SESSION_COOKIE = "attendance_admin";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getSecret() {
  return process.env.QR_SECRET || process.env.ADMIN_PASSWORD || "local-dev-secret-change-before-deploy";
}

function hmac(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function timingEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || "admin123";
}

function displayToken() {
  return process.env.DISPLAY_TOKEN || "";
}

function isSecureRequest(req) {
  const proto = req.headers["x-forwarded-proto"];
  const host = String(req.headers.host || "");
  return proto === "https" || (!host.includes("localhost") && !host.includes("127.0.0.1"));
}

async function makeQrToken(slot = Math.floor(Date.now() / QR_INTERVAL_MS)) {
  return `${slot}.${hmac(`qr:${slot}`).slice(0, 16)}`;
}

async function verifyQrToken(token, graceSlots = QR_SCAN_GRACE_SLOTS) {
  if (typeof token !== "string" || !/^\d+\.[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, reason: "二维码格式不正确" };
  }
  const [slotText, sig] = token.split(".");
  const slot = Number(slotText);
  const nowSlot = Math.floor(Date.now() / QR_INTERVAL_MS);
  if (!Number.isInteger(slot) || slot > nowSlot + 1 || slot < nowSlot - graceSlots) {
    return { ok: false, reason: "二维码已过期，请在现场重新扫码" };
  }
  const expected = (await makeQrToken(slot)).split(".")[1];
  if (!timingEqualText(sig, expected)) return { ok: false, reason: "二维码校验失败" };
  return { ok: true, slot };
}

async function makeCheckinSession(qrToken) {
  const expiresAt = Date.now() + CHECKIN_SESSION_TTL_MS;
  const payload = `${expiresAt}.${qrToken}`;
  return `s.${payload}.${hmac(`scan:${payload}`).slice(0, 24)}`;
}

async function verifyCheckinSession(session) {
  if (typeof session !== "string" || !session.startsWith("s.")) {
    return { ok: false, reason: "扫码会话无效" };
  }
  const parts = session.split(".");
  if (parts.length < 5) return { ok: false, reason: "扫码会话格式错误" };
  const expiresAt = Number(parts[1]);
  const qrToken = `${parts[2]}.${parts[3]}`;
  const sig = parts[4];
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { ok: false, reason: "填写时间过长，请重新扫码" };
  }
  const payload = `${expiresAt}.${qrToken}`;
  const expected = hmac(`scan:${payload}`).slice(0, 24);
  if (!timingEqualText(sig, expected)) return { ok: false, reason: "扫码会话校验失败" };
  return { ok: true, expiresAt, qrToken };
}

async function makeAdminSession() {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const nonce = crypto.randomBytes(12).toString("base64url");
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${hmac(`admin:${payload}`).slice(0, 24)}`;
}

async function verifyAdminSession(req) {
  const session = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (!session) return { ok: false, reason: "请先以管理员身份登录" };
  const parts = session.split(".");
  if (parts.length !== 3) return { ok: false, reason: "管理员登录已失效" };
  const [expiresAtText, nonce, sig] = parts;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { ok: false, reason: "管理员登录已过期" };
  }
  const payload = `${expiresAtText}.${nonce}`;
  const expected = hmac(`admin:${payload}`).slice(0, 24);
  if (!timingEqualText(sig, expected)) return { ok: false, reason: "管理员登录校验失败" };
  return { ok: true, expiresAt };
}

async function requireAdmin(req, res) {
  const verified = await verifyAdminSession(req);
  if (verified.ok) return true;
  json(res, 401, { ok: false, reason: verified.reason });
  return false;
}

async function verifyDisplayAccess(req, url) {
  const required = displayToken();
  if (!required) return { ok: true };
  const provided = url.searchParams.get("displayKey") || "";
  if (timingEqualText(provided, required)) return { ok: true };
  const admin = await verifyAdminSession(req);
  if (admin.ok) return { ok: true };
  return { ok: false, reason: "现场二维码屏未授权" };
}

function adminCookie(session, req) {
  return cookieHeader(ADMIN_SESSION_COOKIE, session, {
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    secure: isSecureRequest(req)
  });
}

function clearAdminCookie(req) {
  return cookieHeader(ADMIN_SESSION_COOKIE, "", {
    maxAge: 0,
    secure: isSecureRequest(req)
  });
}

module.exports = {
  ADMIN_SESSION_TTL_MS,
  CHECKIN_SESSION_TTL_MS,
  QR_INTERVAL_MS,
  adminCookie,
  adminPassword,
  clearAdminCookie,
  makeAdminSession,
  makeCheckinSession,
  makeQrToken,
  requireAdmin,
  timingEqualText,
  verifyAdminSession,
  verifyCheckinSession,
  verifyDisplayAccess,
  verifyQrToken
};
