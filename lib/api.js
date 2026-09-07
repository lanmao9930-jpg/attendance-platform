const crypto = require("node:crypto");
const { URL } = require("node:url");
const {
  activeScheduleRows,
  buildCsv,
  checkinBelongsToBatch,
  computeAttendance,
  currentScheduleBatch,
  findScheduleOccurrence,
  summarizeScheduleBatches
} = require("./attendance");
const { attendanceStatuses, centers, dutyTypes, shifts, studentPositions, weekdays, weeks } = require("./constants");
const { json, methodNotAllowed, readJson } = require("./http");
const { currentQrPayload, makeQrSvg } = require("./qr");
const { parseScheduleWorkbook } = require("./schedule-import");
const {
  CHECKIN_SESSION_TTL_MS,
  adminCookie,
  adminPassword,
  clearAdminCookie,
  displayToken,
  makeAdminSession,
  makeCheckinSession,
  requireAdmin,
  timingEqualText,
  verifyAdminSession,
  verifyCheckinSession,
  verifyDisplayAccess,
  verifyQrToken
} = require("./security");
const {
  loadDb,
  addCheckin,
  loadPhoto,
  loadScheduleHistory,
  loadScheduleHistoryBatch,
  saveReview,
  saveScheduleHistoryBatch,
  saveSchedules,
  storageMode
} = require("./store");
const { publicOrigin } = require("./url");
const { handlePlanningApi } = require("./planning-api");
const { calendarContext, checkinCalendar, belongsToCalendar } = require("./calendar");
const { loadPlanningState } = require("./store");
const { importImpact } = require("./planning");

function route(pathname, ...paths) {
  return paths.includes(pathname);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  // Vercel may expose an individual api function as `/health` rather than `/api/health`.
  const pathname = url.pathname.startsWith("/api/") ? url.pathname : `/api${url.pathname}`;

  if (await handlePlanningApi(req, res, pathname, url, normalizeSchedules)) return;

  if (route(pathname, "/api/options")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    return json(res, 200, { attendanceStatuses, centers, positions: studentPositions, weeks, weekdays, shifts, dutyTypes });
  }

  if (route(pathname, "/api/admin/login", "/api/admin-login")) {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    const body = await readJson(req);
    if (!timingEqualText(body.password, adminPassword())) {
      return json(res, 401, { ok: false, reason: "管理员口令不正确" });
    }
    const session = await makeAdminSession();
    return json(res, 200, { ok: true }, { "Set-Cookie": adminCookie(session, req) });
  }

  if (route(pathname, "/api/admin/logout", "/api/admin-logout")) {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    return json(res, 200, { ok: true }, { "Set-Cookie": clearAdminCookie(req) });
  }

  if (route(pathname, "/api/admin/me", "/api/admin-me")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    const verified = await verifyAdminSession(req);
    return json(res, verified.ok ? 200 : 401, verified);
  }

  if (route(pathname, "/api/admin/storage", "/api/admin-storage")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    return json(res, 200, {
      ok: true,
      mode: storageMode(),
      publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL || publicOrigin(req)
    });
  }

  if (route(pathname, "/api/admin/display-url", "/api/admin-display-url")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    const token = displayToken();
    const displayUrl = `${publicOrigin(req)}/display${token ? `?key=${encodeURIComponent(token)}` : ""}`;
    return json(res, 200, { ok: true, displayUrl });
  }

  if (route(pathname, "/api/health")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    return json(res, 200, {
      ok: true,
      app: "attendance-platform",
      version: "0.10.1",
      publicOrigin: publicOrigin(req),
      storageMode: storageMode(),
      env: {
        hasPublicBaseUrl: Boolean(process.env.PUBLIC_BASE_URL),
        hasAdminPassword: Boolean(process.env.ADMIN_PASSWORD),
        hasQrSecret: Boolean(process.env.QR_SECRET),
        hasDisplayToken: Boolean(displayToken()),
        hasBlob: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
        hasCloudBase: Boolean(process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV),
        vercelUrl: Boolean(process.env.VERCEL_URL)
      }
    });
  }

  if (route(pathname, "/api/current-qr")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    const display = await verifyDisplayAccess(req, url);
    if (!display.ok) return json(res, 401, display);
    return json(res, 200, await currentQrPayload(req));
  }

  if (route(pathname, "/api/qr.svg", "/api/qr-svg")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    const token = url.searchParams.get("token") || "";
    const origin = publicOrigin(req);
    const checkinUrl = `${origin}/student?token=${encodeURIComponent(token)}`;
    const svg = await makeQrSvg(checkinUrl);
    res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
    res.end(svg);
    return;
  }

  if (route(pathname, "/api/open-checkin")) {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    const body = await readJson(req);
    const verified = await verifyQrToken(body.token);
    if (!verified.ok) return json(res, 400, verified);
    const session = await makeCheckinSession(body.token);
    return json(res, 200, {
      ok: true,
      session,
      expiresAt: Date.now() + CHECKIN_SESSION_TTL_MS,
      options: { attendanceStatuses, centers, positions: studentPositions, weeks, weekdays, shifts, dutyTypes }
    });
  }

  if (route(pathname, "/api/checkins")) {
    if (req.method === "POST") return createCheckin(req, res);
    if (req.method === "GET") {
      if (!(await requireAdmin(req, res))) return;
      const db = await loadDb();
      const activeBatch = currentScheduleBatch(db.schedules);
      const unmatchedById = new Map(computeAttendance(db).unmatched.map((record) => [record.id, record]));
      const checkins = (db.checkins || []).map((record) => {
        const unmatched = unmatchedById.get(record.id);
        const isHistorical = !checkinBelongsToBatch(record, activeBatch) || !belongsToCalendar(record, db.calendar);
        const isSwap = record.dutyType === "调班" || record.abnormalType === "调班";
        return {
          ...record,
          matchStatus: isHistorical ? "历史记录" : (unmatched ? unmatched.status : (isSwap ? "调班" : "已匹配")),
          matchReason: isHistorical
            ? "属于上一版固定排班，已保留归档"
            : (unmatched?.reason || (isSwap ? "学生申报调班，已自动关联固定排班" : "已匹配固定排班"))
        };
      });
      return json(res, 200, { checkins });
    }
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  if (route(pathname, "/api/schedules")) {
    if (!(await requireAdmin(req, res))) return;
    if (req.method === "GET") {
      const db = await loadDb();
      const requestedBatchId = String(url.searchParams.get("batchId") || "").trim();
      const activeSchedules = activeScheduleRows(db.schedules);
      const activeBatch = currentScheduleBatch(activeSchedules);
      const schedules = requestedBatchId
        ? (requestedBatchId === activeBatch.id ? activeSchedules : await loadScheduleHistoryBatch(requestedBatchId))
        : activeSchedules;
      if (requestedBatchId && !schedules.length) {
        return json(res, 404, { ok: false, reason: "排班版本不存在" });
      }
      const batches = await scheduleBatchCatalog(activeSchedules);
      return json(res, 200, {
        schedules,
        batches,
        totalStored: batches.reduce((sum, batch) => sum + batch.count, 0),
        viewingBatchId: requestedBatchId
      });
    }
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  if (route(pathname, "/api/schedule-import/preview")) {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    if (!(await requireAdmin(req, res))) return;
    const body = await readJson(req);
    try {
      const parsed = parseScheduleWorkbook(body);
      if (!parsed.schedules.length) {
        return json(res, 200, { ok: true, ...parsed, count: 0, notTwoDuties: [] });
      }
      const normalized = normalizeSchedules(parsed.schedules);
      if (!normalized.ok) return json(res, 400, normalized);
      const state = await loadPlanningState();
      const existing = await loadDb();
      return json(res, 200, {
        ok: true,
        ...parsed,
        schedules: normalized.schedules,
        revision: state.revision,
        impact: importImpact(existing.schedules, normalized.schedules),
        count: normalized.schedules.length,
        notTwoDuties: normalized.notTwoDuties
      });
    } catch (error) {
      return json(res, 400, { ok: false, reason: error.message || "表格解析失败" });
    }
  }

  if (route(pathname, "/api/reviews")) {
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    if (!(await requireAdmin(req, res))) return;
    const body = await readJson(req);
    const db = await loadDb();
    const scheduleId = String(body.scheduleId || "").trim();
    const status = String(body.status || "").trim();
    const remark = String(body.remark || "").trim();
    if (!findScheduleOccurrence(activeScheduleRows(db.schedules), scheduleId)) {
      return json(res, 400, { ok: false, reason: "排班记录不存在" });
    }
    if (!attendanceStatuses.includes(status)) {
      return json(res, 400, { ok: false, reason: "考勤状态不合法" });
    }
    if (status === "调班" && !remark) {
      return json(res, 400, { ok: false, reason: "调班必须填写备注" });
    }
    const review = {
      scheduleId,
      status,
      remark,
      updatedAt: new Date().toISOString()
    };
    await saveReview(review);
    return json(res, 200, { ok: true, review });
  }

  if (route(pathname, "/api/photo")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    const recordId = url.searchParams.get("id") || "";
    const db = await loadDb();
    const record = (db.checkins || []).find((item) => item.id === recordId);
    const photo = await loadPhoto(record);
    if (!photo) return json(res, 404, { ok: false, reason: "照片不存在" });
    res.writeHead(200, {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, no-store"
    });
    res.end(photo.buffer);
    return;
  }

  if (route(pathname, "/api/summary")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    const db = await loadDb();
    const week = url.searchParams.has("week") ? weekNumber(url.searchParams.get("week")) : (calendarContext(db.calendar).week || 1);
    const center = String(url.searchParams.get("center") || "").trim();
    if (url.searchParams.has("week") && !weeks.includes(week)) {
      return json(res, 400, { ok: false, reason: "周次应为 1 至 20" });
    }
    if (center && !centers.includes(center)) return json(res, 400, { ok: false, reason: "中心名称不合法" });
    return json(res, 200, computeAttendance(db, { week, center }));
  }

  if (route(pathname, "/api/export.csv", "/api/export")) {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
    if (!(await requireAdmin(req, res))) return;
    const db = await loadDb();
    const week = url.searchParams.has("week") ? weekNumber(url.searchParams.get("week")) : (calendarContext(db.calendar).week || 1);
    const center = String(url.searchParams.get("center") || "").trim();
    if (url.searchParams.has("week") && !weeks.includes(week)) {
      return json(res, 400, { ok: false, reason: "周次应为 1 至 20" });
    }
    if (center && !centers.includes(center)) return json(res, 400, { ok: false, reason: "中心名称不合法" });
    const csv = buildCsv(computeAttendance(db, { week, center }));
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

  const state = await loadPlanningState();
  const submittedAt = new Date();
  let actualCalendar;
  try { actualCalendar = checkinCalendar(state.calendar, submittedAt); }
  catch (error) { return json(res, 400, { ok: false, reason: error.message }); }
  if (body.dutyDate && body.dutyDate !== actualCalendar.dutyDate) {
    return json(res, 409, { ok: false, reason: "日期已变化，请重新扫码确认当天值班" });
  }
  const record = {
    id: crypto.randomUUID(),
    createdAt: submittedAt.toISOString(),
    qrToken: verified.qrToken,
    name: String(body.name || "").trim(),
    center: String(body.center || "").trim(),
    dutyType: String(body.dutyType || "").trim(),
    ...actualCalendar,
    position: String(body.position || "").trim(),

    shifts: Array.isArray(body.shifts)
      ? [...new Set(body.shifts.map((shift) => String(shift).trim()).filter(Boolean))]
      : [],
    abnormalType: String(body.dutyType || "").trim() === "调班" ? "调班" : "否",
    swapTime: String(body.swapTime || "").trim(),
    attendanceType: String(body.attendanceType || "").trim(),
    continuousDuty: String(body.continuousDuty || "").trim(),
    internAttendanceType: String(body.internAttendanceType || "").trim(),
    remark: String(body.remark || "").trim(),
    photoName: String(body.photoName || "").trim()
  };

  const required = ["name", "center", "position", "dutyType", "week", "weekday", "attendanceType"];
  const missing = required.filter((key) => !record[key]);
  if (!record.shifts.length) missing.push("shifts");
  if (!body.photoDataUrl) missing.push("photo");
  if (missing.length) return json(res, 400, { ok: false, reason: `缺少必填项：${missing.join(", ")}` });
  if (!centers.includes(record.center) || !dutyTypes.includes(record.dutyType)) {
    return json(res, 400, { ok: false, reason: "中心或值班类型不合法" });
  }
  if (!studentPositions.includes(record.position)) {
    return json(res, 400, { ok: false, reason: "职位信息不合法" });
  }
  if (record.dutyType === "调班" && !record.swapTime) {
    return json(res, 400, { ok: false, reason: "选择调班时必须填写具体调班说明" });
  }
  if (!weeks.includes(record.week) || !weekdays.includes(record.weekday)) {
    return json(res, 400, { ok: false, reason: "值班时间不合法" });
  }
  if (!record.shifts.every((shift) => shifts.some((item) => item.label === shift))) {
    return json(res, 400, { ok: false, reason: "节次不合法" });
  }
  if (!["签到", "签退"].includes(record.attendanceType)) {
    return json(res, 400, { ok: false, reason: "考勤类别不合法" });
  }
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(body.photoDataUrl))) {
    return json(res, 400, { ok: false, reason: "值班照片格式不合法" });
  }

  const db = await loadDb();
  const activeBatch = currentScheduleBatch(db.schedules);
  if (activeBatch.id) {
    record.scheduleBatchId = activeBatch.id;
    record.scheduleBatchName = activeBatch.name;
  }
  const storedRecord = await addCheckin(record, String(body.photoDataUrl || ""));
  return json(res, 200, { ok: true, record: storedRecord });
}

function normalizeSchedules(source) {
  if (!Array.isArray(source) || !source.length) {
    return { ok: false, reason: "请先导入至少一条排班记录" };
  }
  const errors = [];
  const seen = new Set();
  const normalized = [];
  source.forEach((item, index) => {
    const row = normalizeSchedule(item, index);
    if (!row.ok) {
      errors.push(`第 ${index + 1} 条：${row.reason}`);
      return;
    }
    const key = [row.value.center, row.value.weeks.join(","), row.value.weekday, row.value.shift, row.value.name].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(row.value);
  });
  if (errors.length) return { ok: false, reason: errors.slice(0, 6).join("；") };
  const counts = new Map();
  normalized.forEach((row) => {
    const key = `${row.center}|${row.name}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const notTwoDuties = [...counts.entries()]
    .filter(([, count]) => count !== 2)
    .map(([key, count]) => ({ center: key.split("|")[0], name: key.split("|")[1], count }));
  return { ok: true, schedules: normalized, notTwoDuties };
}

function normalizeSchedule(item, index) {
  const scheduleWeeks = normalizeScheduleWeeks(item);
  const week = scheduleWeeks.length === 1 ? scheduleWeeks[0] : 0;
  const center = String(item?.center || "").trim();
  const weekday = String(item?.weekday || "").trim();
  const shift = String(item?.shift || "").trim();
  const name = String(item?.name || "").trim();
  if (!centers.includes(center)) return { ok: false, reason: "中心名称不在预设范围内" };
  if (!scheduleWeeks.length) return { ok: false, reason: "周次应为 1 至 20，或提供有效的周期周次" };
  if (!weekdays.includes(weekday)) return { ok: false, reason: "星期应为星期一至星期五" };
  if (!shifts.some((item) => item.label === shift)) return { ok: false, reason: "节次不在预设范围内" };
  if (!name) return { ok: false, reason: "缺少值班人员姓名" };
  return {
    ok: true,
    value: {
      id: String(item?.id || crypto.randomUUID()),
      center,
      week,
      weeks: scheduleWeeks,
      weekLabel: String(item?.weekLabel || defaultWeekLabel(scheduleWeeks)).trim(),
      weekday,
      shift,
      name,
      position: String(item?.position || "").trim(),
      phone: String(item?.phone || "").trim(),
      importedAt: new Date().toISOString(),
      importOrder: index + 1
    }
  };
}

function normalizeScheduleWeeks(item) {
  const source = Array.isArray(item?.weeks) ? item.weeks : [weekNumber(item?.week)];
  return [...new Set(source.map(weekNumber).filter((week) => weeks.includes(week)))].sort((a, b) => a - b);
}

function defaultWeekLabel(scheduleWeeks) {
  if (scheduleWeeks.length === 20) return "每周";
  if (scheduleWeeks.length === 10 && scheduleWeeks.every((week) => week % 2 === 1)) return "单周";
  if (scheduleWeeks.length === 10 && scheduleWeeks.every((week) => week % 2 === 0)) return "双周";
  if (scheduleWeeks.length === 1) return `第${scheduleWeeks[0]}周`;
  return scheduleWeeks.map((week) => `第${week}周`).join("、");
}

function weekNumber(value) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function cleanBatchName(value, now) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (name) return name;
  return `固定排班 ${new Date(now).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
}

function legacyScheduleBatchId(schedules) {
  const fingerprint = (schedules || []).map((schedule) => schedule.id).sort().join("|");
  return `legacy-${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 16)}`;
}

function scheduleCreatedAt(schedules) {
  return (schedules || [])
    .map((schedule) => schedule.batchCreatedAt || schedule.importedAt || "")
    .filter(Boolean)
    .sort()[0] || "";
}

async function scheduleBatchCatalog(activeSchedules) {
  const current = summarizeScheduleBatches(activeSchedules);
  const history = await loadScheduleHistory();
  return [...current, ...history].sort((left, right) => (
    Number(right.isActive) - Number(left.isActive)
    || String(right.createdAt).localeCompare(String(left.createdAt))
  ));
}

module.exports = {
  handleApi
};
