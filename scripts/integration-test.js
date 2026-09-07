const assert = require("node:assert/strict");
const XLSX = require("xlsx");

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:8789";
let adminCookie = "";

async function request(path, options = {}, useAdmin = false) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (useAdmin && adminCookie) headers.Cookie = adminCookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const cookie = response.headers.get("set-cookie");
  if (cookie) adminCookie = cookie.split(";")[0];
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body, contentType };
}

function json(value) {
  return JSON.stringify(value);
}

function scheduleWorkbookDataUrl() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["\u884c\u653f\u4e8b\u52a1\u4e2d\u5fc3\u56fa\u5b9a\u6392\u73ed"],
    [],
    ["\u5468\u6b21", "\u661f\u671f", "\u8282\u6b21", "\u5b66\u53f7", "\u503c\u73ed\u4eba\u5458", "\u804c\u4f4d", "\u8054\u7cfb\u7535\u8bdd"],
    ["\u7b2c14\u5468", "\u661f\u671f\u4e00", "\u4e00\u4e8c\u8282", "20260001", "\u6d4b\u8bd5\u540c\u5b66", "\u5b66\u751f\u52a9\u7406", "13800000000"]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "\u6392\u73ed\u5bfc\u5165");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`;
}

async function run() {
  const publicPages = await Promise.all(["/", "/display", "/student?token=test"].map(p => request(p)));
  for (const page of publicPages) { assert.equal(page.response.status, 200); assert.doesNotMatch(page.body, /admin/i); }
  for (const endpoint of ["/api/schedules", "/api/semester", "/api/schedule-imports", "/api/checkins", "/api/photo?id=x"]) {
    assert.equal((await request(endpoint)).response.status, 401);
  }
  const login = await request("/api/admin-login", { method: "POST", body: json({ account: "admin", password: "12345678" }) });
  assert.equal(login.response.status, 200);
  let timing = await request("/api/semester", {}, true);
  assert.equal(timing.body.calendar.startDate, "2026-09-07");
  assert.equal(timing.body.calendar.week, 1);
  let revision = timing.body.revision;
  const preview = await request("/api/schedule-import/preview", { method: "POST", body: json({
    fileName: "schedule.xlsx", fileDataUrl: scheduleWorkbookDataUrl()
  }) }, true);
  assert.equal(preview.response.status, 200, json(preview.body));
  assert.equal(preview.body.count, 1);
  const a = { ...preview.body.schedules[0], week: 1, weeks: [1], weekLabel: "第1周" };
  const b = { ...a, id: "b", studentNo: "20260002", name: "数据同学", center: "大数据中心" };
  async function importRows(rows, extra = {}) {
    const result = await request("/api/schedules", { method: "POST", body: json({ schedules: rows, expectedRevision: revision, ...extra }) }, true);
    if (result.response.ok) revision = result.body.revision;
    return result;
  }
  const first = await importRows([a]);
  assert.equal(first.response.status, 200, json(first.body));
  assert.equal(first.body.count, 1);
  const firstId = first.body.schedules[0].id;
  const second = await importRows([b]);
  assert.equal(second.body.count, 2);
  assert.ok(second.body.schedules.some(row => row.id === firstId));
  const reviewed = await request("/api/reviews", { method: "POST", body: json({ scheduleId: firstId, status: "请假", remark: "测试复核" }) }, true);
  assert.equal(reviewed.response.status, 200);
  const bUpdated = await importRows([{ ...b, shift: "三四节" }]);
  assert.equal(bUpdated.body.count, 2);
  assert.equal(bUpdated.body.impact[0].action, "更新");
  const summary = await request("/api/summary", {}, true);
  assert.equal(summary.body.rows.find(row => row.id === firstId).status, "请假");
  assert.equal(summary.body.rows[0].date, "2026-09-07");
  const duplicate = await importRows([{ ...b, shift: "三四节" }, { ...b, shift: "三四节" }]);
  assert.equal(duplicate.body.count, 2);
  assert.equal((await importRows([a], { expectedRevision: 0 })).response.status, 409);
  assert.equal((await importRows([a], { mode: "new-batch" })).response.status, 400);
  const snapshots = await request("/api/schedule-imports", {}, true);
  assert.ok(snapshots.body.imports.length >= 4);
  const snap = await request("/api/schedule-imports?id=" + bUpdated.body.snapshotId, {}, true);
  assert.ok(snap.body.schedules.some(row => row.center === b.center && row.shift === "一二节"));

  const qr = await request("/api/current-qr", {}, true);
  const opened = await request("/api/open-checkin", { method: "POST", body: json({ token: qr.body.token }) });
  assert.equal(opened.response.status, 200);
  assert.ok(opened.body.options.positions.includes("副团长"));
  const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7P+UAAAAASUVORK5CYII=";
  const record = { session: opened.body.session, name: a.name, center: a.center, studentNo: a.studentNo, position: "副团长",
    dutyType: "正常", week: 19, weekday: "星期五", shifts: ["五六节", "七八节", "五六节"], attendanceType: "签到", photoName: "test.png", photoDataUrl: photo };
  const saved = await request("/api/checkins", { method: "POST", body: json(record) });
  assert.equal(saved.response.status, 200, json(saved.body));
  assert.equal(saved.body.record.position, "副团长");
  assert.equal(saved.body.record.week, 1);
  assert.equal(saved.body.record.weekday, "星期一");
  assert.deepEqual(saved.body.record.shifts, ["五六节", "七八节"]);
  const photoResponse = await request("/api/photo?id=" + saved.body.record.id, {}, true);
  assert.equal(photoResponse.response.status, 200);
  const missingNote = await request("/api/checkins", { method: "POST", body: json({ ...record, shifts: ["三四节"], dutyType: "调班" }) });
  assert.equal(missingNote.response.status, 400);
  const swap = await request("/api/checkins", { method: "POST", body: json({ ...record, shifts: ["三四节"], dutyType: "调班", swapTime: "原星期一一二节改为三四节" }) });
  assert.equal(swap.response.status, 200);
  const staleDate = await request("/api/checkins", { method: "POST", body: json({ ...record, dutyDate: "2026-09-06" }) });
  assert.equal(staleDate.response.status, 409);
  const blockedEdit = await request("/api/semester", { method: "POST", body: json({
    action: "calendar", expectedRevision: revision, calendar: { name: "错误日期", startDate: "2026-09-14", weekCount: 20 }
  }) }, true);
  assert.equal(blockedEdit.response.status, 409);
  const semester = await request("/api/semester", { method: "POST", body: json({
    action: "new-semester", confirm: true, expectedRevision: revision,
    calendar: { name: "2027年春季", startDate: "2027-03-01", weekCount: 20 }
  }) }, true);
  assert.equal(semester.response.status, 200, json(semester.body));
  assert.equal(semester.body.count, 0);
  revision = semester.body.revision;
  assert.equal((await request("/api/calendar")).body.calendar.status, "before");
  assert.equal((await request("/api/checkins", { method: "POST", body: json(record) })).response.status, 400);
  const raw = await request("/api/checkins", {}, true);
  assert.ok(raw.body.checkins.every(row => row.matchStatus === "历史记录"));
  const historical = await request("/api/schedule-imports?id=" + semester.body.snapshotId, {}, true);
  assert.equal(historical.body.schedules.length, 2);
  const next = await importRows([a]);
  assert.equal(next.body.count, 1);
  assert.equal(next.body.calendar.startDate, "2027-03-01");
  console.log("Integration passed: calendar, multi-center updates, snapshots, student clock, auth, photos and semester archive.");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
