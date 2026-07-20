const assert = require("node:assert/strict");
const { centers, dutyTypes, positions, shifts, weekdays } = require("../lib/constants");

const baseUrl = process.env.CLOUDBASE_BASE_URL || "https://attendance-platform-d1b99a89a6e3.service.tcloudbase.com";
const adminPassword = process.env.CLOUDBASE_ADMIN_PASSWORD;
let adminCookie = "";

async function request(path, options = {}, useAdmin = false) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (useAdmin && adminCookie) headers.Cookie = adminCookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) adminCookie = setCookie.split(";")[0];
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function run() {
  if (!adminPassword) throw new Error("CLOUDBASE_ADMIN_PASSWORD is required");

  const root = await request("/");
  const displayPage = await request("/display");
  const studentPage = await request("/student?token=test");
  assert.equal(root.response.status, 200);
  assert.doesNotMatch(root.body, /admin/i);
  assert.doesNotMatch(displayPage.body, /admin/i);
  assert.doesNotMatch(studentPage.body, /admin/i);

  const health = await request("/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.storageMode, "cloudbase");

  const protectedQr = await request("/api/current-qr");
  assert.equal(protectedQr.response.status, 401);

  const login = await request("/api/admin-login", {
    method: "POST",
    body: JSON.stringify({ password: adminPassword })
  });
  assert.equal(login.response.status, 200);

  const [storage, schedules, checkins, displayUrl, qr] = await Promise.all([
    request("/api/admin-storage", {}, true),
    request("/api/schedules", {}, true),
    request("/api/checkins", {}, true),
    request("/api/admin-display-url", {}, true),
    request("/api/current-qr", {}, true)
  ]);
  assert.equal(storage.body.mode, "cloudbase");
  assert.ok(Array.isArray(schedules.body.schedules));
  assert.ok(Array.isArray(checkins.body.checkins));
  assert.match(displayUrl.body.displayUrl, /\/display\?key=/);
  assert.match(qr.body.checkinUrl, /\/student\?token=/);

  const studentSession = await request("/api/open-checkin", {
    method: "POST",
    body: JSON.stringify({ token: qr.body.token })
  });
  assert.equal(studentSession.response.status, 200);

  let writeTest = null;
  if (process.env.CLOUDBASE_WRITE_TEST === "1") {
    assert.equal(schedules.body.schedules.length, 0, "Write test requires an empty schedule collection");
    assert.equal(checkins.body.checkins.length, 0, "Write test requires an empty check-in collection");

    const testName = "CloudBase deployment verification";
    const imported = await request("/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        schedules: [{
          center: centers[2],
          week: 14,
          weekday: weekdays[0],
          shift: shifts[0].label,
          name: testName,
          position: positions[5],
          phone: "13800000000"
        }]
      })
    }, true);
    assert.equal(imported.response.status, 200);
    assert.equal(imported.body.count, 1);

    const photoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7P+UAAAAASUVORK5CYII=";
    const saved = await request("/api/checkins", {
      method: "POST",
      body: JSON.stringify({
        session: studentSession.body.session,
        name: testName,
        center: centers[2],
        dutyType: dutyTypes[0],
        week: 14,
        weekday: weekdays[0],
        shifts: [shifts[0].label],
        attendanceType: "\u7b7e\u5230",
        photoName: "cloudbase-test.png",
        photoDataUrl
      })
    });
    assert.equal(saved.response.status, 200);

    const scheduleId = imported.body.schedules[0].id;
    const rejectedReview = await request("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ scheduleId, status: "\u8c03\u73ed", remark: "" })
    }, true);
    assert.equal(rejectedReview.response.status, 400);

    const review = await request("/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        scheduleId,
        status: "\u8c03\u73ed",
        remark: "CloudBase deployment verification"
      })
    }, true);
    assert.equal(review.response.status, 200);

    const summary = await request("/api/summary", {}, true);
    const summaryRow = summary.body.rows.find((row) => row.id === scheduleId);
    assert.equal(summaryRow.status, "\u8c03\u73ed");

    const photo = await request(`/api/photo?id=${encodeURIComponent(saved.body.record.id)}`, {}, true);
    assert.equal(photo.response.status, 200);
    writeTest = {
      scheduleId,
      recordId: saved.body.record.id,
      photoPath: saved.body.record.photoPath,
      photoReadableByAdmin: true,
      finalStatus: summaryRow.status
    };
  }

  console.log(JSON.stringify({
    version: health.body.version,
    storage: storage.body.mode,
    adminLogin: true,
    displayProtected: true,
    studentSession: true,
    scheduleCount: schedules.body.schedules.length,
    checkinCount: checkins.body.checkins.length,
    writeTest
  }));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
