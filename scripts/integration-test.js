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
    ["\u5468\u6b21", "\u661f\u671f", "\u8282\u6b21", "\u503c\u73ed\u4eba\u5458", "\u804c\u4f4d", "\u8054\u7cfb\u7535\u8bdd"],
    ["\u7b2c14\u5468", "\u661f\u671f\u4e00", "\u4e00\u4e8c\u8282", "\u6d4b\u8bd5\u540c\u5b66", "\u5b66\u751f\u52a9\u7406", "13800000000"]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "\u6392\u73ed\u5bfc\u5165");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`;
}

async function run() {
  const root = await request("/");
  const displayPage = await request("/display");
  const studentPage = await request("/student?token=test");
  assert.equal(root.response.status, 200);
  assert.match(root.body, /\/display/);
  assert.doesNotMatch(root.body, /admin/i);
  assert.doesNotMatch(displayPage.body, /admin/i);
  assert.doesNotMatch(studentPage.body, /admin/i);

  const health = await request("/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const protectedWithoutLogin = await request("/api/schedules");
  assert.equal(protectedWithoutLogin.response.status, 401);

  const displayWithoutKey = await request("/api/current-qr");
  assert.equal(displayWithoutKey.response.status, 401);

  const display = await request("/api/current-qr?displayKey=display-test-key");
  assert.equal(display.response.status, 200);
  assert.match(display.body.checkinUrl, /\/student\?token=/);

  const studentSession = await request("/api/open-checkin", {
    method: "POST",
    body: json({ token: display.body.token })
  });
  assert.equal(studentSession.response.status, 200);
  assert.ok(studentSession.body.session);

  const login = await request("/api/admin-login", {
    method: "POST",
    body: json({ password: "12345678" })
  });
  assert.equal(login.response.status, 200);
  assert.match(adminCookie, /^attendance_admin=/);

  const adminDisplay = await request("/api/admin-display-url", {}, true);
  assert.equal(adminDisplay.response.status, 200);
  assert.match(adminDisplay.body.displayUrl, /\/display\?key=display-test-key$/);

  const preview = await request("/api/schedule-import/preview", {
    method: "POST",
    body: json({
      fileName: "\u817e\u8baf\u6587\u6863\u56fa\u5b9a\u6392\u73ed.xlsx",
      fileDataUrl: scheduleWorkbookDataUrl()
    })
  }, true);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.count, 1);
  assert.equal(preview.body.issueCount, 0);

  const imported = await request("/api/schedules", {
    method: "POST",
    body: json({ schedules: preview.body.schedules })
  }, true);
  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.count, 1);

  const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7P+UAAAAASUVORK5CYII=";
  const studentRecord = {
    session: studentSession.body.session,
    name: "\u6d4b\u8bd5\u540c\u5b66",
    center: "\u884c\u653f\u4e8b\u52a1\u4e2d\u5fc3",
    dutyType: "\u7ebf\u4e0b",
    week: 14,
    weekday: "\u661f\u671f\u4e00",
    shifts: ["\u4e00\u4e8c\u8282"],
    photoName: "test.png",
    photoDataUrl: photo
  };
  const signIn = await request("/api/checkins", { method: "POST", body: json({ ...studentRecord, attendanceType: "\u7b7e\u5230" }) });
  const signOut = await request("/api/checkins", { method: "POST", body: json({ ...studentRecord, attendanceType: "\u7b7e\u9000" }) });
  assert.equal(signIn.response.status, 200);
  assert.equal(signOut.response.status, 200);

  const rejectedReview = await request("/api/reviews", {
    method: "POST",
    body: json({ scheduleId: imported.body.schedules[0].id, status: "\u8c03\u73ed", remark: "" })
  }, true);
  assert.equal(rejectedReview.response.status, 400);

  const savedReview = await request("/api/reviews", {
    method: "POST",
    body: json({ scheduleId: imported.body.schedules[0].id, status: "\u8c03\u73ed", remark: "\u6d4b\u8bd5\uff1a\u4e0e\u540c\u5b66\u4e92\u6362\u503c\u73ed" })
  }, true);
  assert.equal(savedReview.response.status, 200);

  const summary = await request("/api/summary", {}, true);
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.rows[0].status, "\u8c03\u73ed");

  const photoResult = await request(`/api/photo?id=${encodeURIComponent(signIn.body.record.id)}`, {}, true);
  assert.equal(photoResult.response.status, 200);
  assert.match(photoResult.contentType, /^image\//);

  console.log(JSON.stringify({
    health: health.body.version,
    storage: health.body.storageMode,
    displayUrlProtected: /display\?key=display-test-key$/.test(adminDisplay.body.displayUrl),
    importedSchedules: imported.body.count,
    finalStatus: summary.body.rows[0].status,
    photoContentType: photoResult.contentType
  }));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
