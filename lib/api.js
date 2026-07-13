const crypto = require("node:crypto");
const { URL } = require("node:url");
const { buildCsv, computeAttendance } = require("./attendance");
const { centers, dutyTypes, positions, shifts, weekdays, weeks } = require("./constants");
const { json, methodNotAllowed, readJson } = require("./http");
const { currentQrPayload, makeQrSvg } = require("./qr");
const {
  CHECKIN_SESSION_TTL_MS,
  adminCookie,
  adminPassword,
  clearAdminCookie,
  makeAdminSession,
  makeCheckinSession,
  requireAdmin,
  timingEqualText,
  verifyAdminSession,
  verifyCheckinSession,
  verifyDisplayAccess,
  verifyQrToken
} = require("./security");
const { loadDb, addCheckin, storageMode } = require("./store");
const { publicOrigin } = require("./url");

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/api/options") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    return json(res, 200, { centers, positions, weeks, weekdays, shifts, dutyTypes });
  }

  if (pathname === "/api/admin/login") {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    const body = await readJson(req);
    if (!timingEqualText(body.password, adminPassword())) {
      return json(res, 401, { ok: false, reason: "管理员口令不正确" });
    }
    const session = await makeAdminSession();
    return json(res, 200, { ok: true }, { "Set-Cookie": adminCookie(session, req) });
  }

  if (pathname === "/api/admin/logout") {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    return json(res, 200, { ok: true }, { "Set-Cookie": clearAdminCookie(req) });
  }

  if (pathname === "/api/admin/me") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    const verified = await verifyAdminSession(req);
    return json(res, verified.ok ? 200 : 401, verified);
  }

  if (pathname === "/api/admin/storage") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    return json(res, 200, {
      ok: true,
      mode: storageMode(),
      publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL || publicOrigin(req)
    });
  }

  if (pathname === "/api/health") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    return json(res, 200, {
      ok: true,
      app: "attendance-platform",
      version: "0.1.1",
      publicOrigin: publicOrigin(req),
      storageMode: storageMode(),
      env: {
        hasPublicBaseUrl: Boolean(process.env.PUBLIC_BASE_URL),
        hasAdminPassword: Boolean(process.env.ADMIN_PASSWORD),
        hasQrSecret: Boolean(process.env.QR_SECRET),
        hasDisplayToken: Boolean(process.env.DISPLAY_TOKEN),
        hasBlob: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
        vercelUrl: Boolean(process.env.VERCEL_URL)
      }
    });
  }

  if (pathname === "/api/current-qr") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    const display = await verifyDisplayAccess(req, url);
    if (!display.ok) return json(res, 401, display);
    return json(res, 200, await currentQrPayload(req));
  }

  if (pathname === "/api/qr.svg") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    const token = url.searchParams.get("token") || "";
    const origin = publicOrigin(req);
    const checkinUrl = `${origin}/student?token=${encodeURIComponent(token)}`;
    const svg = await makeQrSvg(checkinUrl);
    res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
    res.end(svg);
    return;
  }

  if (pathname === "/api/open-checkin") {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    const body = await readJson(req);
    const verified = await verifyQrToken(body.token);
    if (!verified.ok) return json(res, 400, verified);
    const session = await makeCheckinSession(body.token);
    return json(res, 200, {
      ok: true,
      session,
      expiresAt: Date.now() + CHECKIN_SESSION_TTL_MS,
      options: { centers, positions, weeks, weekdays, shifts, dutyTypes }
    });
  }

  if (pathname === "/api/checkins") {
    if (req.method === "POST") return createCheckin(req, res);
    if (req.method === "GET") {
      if (!(await requireAdmin(req, res))) return;
      const db = await loadDb();
      return json(res, 200, { checkins: db.checkins || [] });
    }
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  if (pathname === "/api/summary") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    const db = await loadDb();
    return json(res, 200, computeAttendance(db));
  }

  if (pathname === "/api/export.csv") {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    const db = await loadDb();
    const csv = buildCsv(computeAttendance(db));
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"attendance-summary.csv\""
    });
    res.end(csv);
    return;
  }

  json(res, 404, { ok: false, reason: "接口不存在" });
}

async function createCheckin(req, res) {
  const body = await readJson(req);
  const verified = await verifyCheckinSession(body.session);
  if (!verified.ok) return json(res, 400, verified);

  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    qrToken: verified.qrToken,
    name: String(body.name || "").trim(),
    center: String(body.center || "").trim(),
    dutyType: String(body.dutyType || "").trim(),
    week: Number(body.week || 0),
    position: String(body.position || "").trim(),
    weekday: String(body.weekday || "").trim(),
    shifts: Array.isArray(body.shifts) ? body.shifts.map(String) : [],
    abnormalType: String(body.abnormalType || "否").trim(),
    swapTime: String(body.swapTime || "").trim(),
    attendanceType: String(body.attendanceType || "").trim(),
    continuousDuty: String(body.continuousDuty || "").trim(),
    internAttendanceType: String(body.internAttendanceType || "").trim(),
    remark: String(body.remark || "").trim(),
    photoName: String(body.photoName || "").trim()
  };

  const required = ["name", "center", "dutyType", "week", "weekday", "attendanceType"];
  const missing = required.filter((key) => !record[key]);
  if (!record.shifts.length) missing.push("shifts");
  if (!body.photoDataUrl) missing.push("photo");
  if (missing.length) return json(res, 400, { ok: false, reason: `缺少必填项：${missing.join(", ")}` });

  const storedRecord = await addCheckin(record, String(body.photoDataUrl || ""));
  return json(res, 200, { ok: true, record: storedRecord });
}

module.exports = {
  handleApi
};
