const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const loginBtn = document.querySelector("#loginBtn");
const adminPassword = document.querySelector("#adminPassword");
const togglePasswordBtn = document.querySelector("#togglePasswordBtn");
const adminApp = document.querySelector("#adminApp");
const panels = document.querySelectorAll("[data-panel]");
const navButtons = document.querySelectorAll(".nav button");
const qrImage = document.querySelector("#qrImage");
const countdownBar = document.querySelector("#countdownBar");
const qrCountdownText = document.querySelector("#qrCountdownText");
const openDisplayBtn = document.querySelector("#openDisplayBtn");
const copyDisplayLinkBtn = document.querySelector("#copyDisplayLinkBtn");
const refreshDataBtn = document.querySelector("#refreshDataBtn");
const logoutBtn = document.querySelector("#logoutBtn");
const importSchedulesBtn = document.querySelector("#importSchedulesBtn");
const schedulePaste = document.querySelector("#schedulePaste");
const scheduleImportNotice = document.querySelector("#scheduleImportNotice");
const reviewNotice = document.querySelector("#reviewNotice");

const attendanceStatuses = ["正常", "调班", "迟到", "缺勤"];
let currentQr = null;
let displayUrl = "";
let countdownTimer = null;
let summaryTimer = null;

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    navButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== button.dataset.view));
  });
});

async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({ reason: "请求失败" }));
  if (!response.ok) {
    const error = new Error(data.reason || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function showLogin(message = "") {
  clearTimers();
  currentQr = null;
  adminApp.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginError.textContent = message;
  loginError.classList.toggle("hidden", !message);
}

function showAdmin() {
  loginScreen.classList.add("hidden");
  adminApp.classList.remove("hidden");
}

function showReviewNotice(message, error = false) {
  reviewNotice.textContent = message;
  reviewNotice.classList.toggle("error", error);
  reviewNotice.classList.toggle("hidden", !message);
}

function clearTimers() {
  if (countdownTimer) clearInterval(countdownTimer);
  if (summaryTimer) clearInterval(summaryTimer);
  countdownTimer = null;
  summaryTimer = null;
}

function handleAuthError(error) {
  if (error.status === 401) {
    showLogin("管理员登录已失效，请重新输入口令。");
    return true;
  }
  return false;
}

async function refreshQr() {
  const data = await fetchJson("/api/current-qr");
  if (!currentQr || currentQr.token !== data.token) {
    currentQr = data;
    qrImage.src = `${data.qrSvgUrl}&t=${Date.now()}`;
  }
}

async function refreshDisplayUrl() {
  const data = await fetchJson("/api/admin-display-url");
  displayUrl = data.displayUrl;
}

function updateCountdown() {
  if (!currentQr) return;
  const left = Math.max(0, currentQr.expiresAt - Date.now());
  const ratio = Math.max(0, Math.min(1, left / currentQr.intervalMs));
  countdownBar.style.width = `${ratio * 100}%`;
  qrCountdownText.textContent = `二维码将在 ${(left / 1000).toFixed(1)} 秒后刷新`;
  if (left <= 150) {
    refreshQr().catch((error) => {
      if (!handleAuthError(error)) qrCountdownText.textContent = error.message;
    });
  }
}

async function refreshData() {
  const [summary, raw, schedules, storage] = await Promise.all([
    fetchJson("/api/summary"),
    fetchJson("/api/checkins"),
    fetchJson("/api/schedules"),
    fetchJson("/api/admin-storage")
  ]);
  renderSummary(summary, raw.checkins, schedules.schedules, storage);
}

function renderSummary(summary, checkins, schedules, storage) {
  document.querySelector("#metricSchedules").textContent = summary.totalSchedules;
  document.querySelector("#metricCheckins").textContent = summary.totalCheckins;
  document.querySelector("#metricNormal").textContent = summary.counts["正常"] || 0;
  document.querySelector("#metricAbnormal").textContent = summary.totalSchedules - (summary.counts["正常"] || 0);
  document.querySelector("#scheduleCount").textContent = summary.totalSchedules;
  document.querySelector("#checkinCount").textContent = summary.totalCheckins;
  const storageLabels = { cloudbase: "CloudBase 云数据库与云存储", "vercel-blob": "Vercel Blob", "local-json": "本地预览" };
  document.querySelector("#storageMode").textContent = storageLabels[storage.mode] || storage.mode;
  document.querySelector("#summaryTime").textContent = `更新时间：${formatTime(summary.generatedAt)}`;
  document.querySelector("#recordsCount").textContent = `${checkins.length} 条`;
  document.querySelector("#scheduleTableCount").textContent = `${schedules.length} 条`;

  renderSchedules(schedules);
  renderReviews(summary.rows);
  renderRecords(checkins);
}

function renderSchedules(schedules) {
  const body = document.querySelector("#scheduleBody");
  body.innerHTML = schedules.length ? schedules.map((row) => `
    <tr>
      <td>${escapeHtml(row.center)}</td><td>第${escapeHtml(row.week)}周</td>
      <td>${escapeHtml(row.weekday)}</td><td>${escapeHtml(row.shift)}</td>
      <td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.position || "-")}</td><td>${escapeHtml(row.phone || "-")}</td>
    </tr>
  `).join("") : "<tr><td colspan=\"7\" class=\"empty-cell\">暂无固定排班</td></tr>";
}

function statusOptions(selected) {
  return attendanceStatuses.map((status) => `<option value="${status}"${status === selected ? " selected" : ""}>${status}</option>`).join("");
}

function renderReviews(rows) {
  const body = document.querySelector("#reviewBody");
  body.innerHTML = rows.length ? rows.map((row) => `
    <tr data-schedule-id="${escapeHtml(row.id)}">
      <td>${escapeHtml(row.center)}</td><td>第${escapeHtml(row.week)}周</td><td>${escapeHtml(row.weekday)}</td><td>${escapeHtml(row.shift)}</td><td>${escapeHtml(row.name)}</td>
      <td>${formatTime(row.signInTime)}</td><td>${formatTime(row.signOutTime)}</td>
      <td>${row.photoRecordId ? `<a class="text-link" href="/api/photo?id=${encodeURIComponent(row.photoRecordId)}" target="_blank" rel="noreferrer">查看</a>` : "-"}</td>
      <td><select class="review-status" aria-label="${escapeHtml(row.name)} 的考勤状态">${statusOptions(row.status)}</select></td>
      <td><input class="review-remark" value="${escapeHtml(row.reviewRemark)}" placeholder="${escapeHtml(row.reason || "备注")}" aria-label="${escapeHtml(row.name)} 的备注"></td>
      <td><button class="button secondary save-review-btn" type="button">保存</button></td>
    </tr>
  `).join("") : "<tr><td colspan=\"11\" class=\"empty-cell\">导入固定排班后显示审核记录</td></tr>";

  body.querySelectorAll(".save-review-btn").forEach((button) => {
    button.addEventListener("click", () => saveReview(button));
  });
}

function renderRecords(records) {
  const body = document.querySelector("#recordsBody");
  body.innerHTML = records.length ? records.map((record) => `
    <tr>
      <td>${formatTime(record.createdAt)}</td><td>${escapeHtml(record.name)}</td><td>${escapeHtml(record.center)}</td>
      <td>${record.week ? `第${escapeHtml(record.week)}周` : "-"}</td><td>${escapeHtml(record.weekday)}</td><td>${escapeHtml((record.shifts || []).join("、"))}</td>
      <td>${escapeHtml(record.dutyType || "-")}</td><td>${escapeHtml(record.attendanceType || "-")}</td>
      <td>${record.photoStored ? `<a class="text-link" href="/api/photo?id=${encodeURIComponent(record.id)}" target="_blank" rel="noreferrer">查看</a>` : "-"}</td>
    </tr>
  `).join("") : "<tr><td colspan=\"9\" class=\"empty-cell\">暂无原始记录</td></tr>";
}

async function saveReview(button) {
  const row = button.closest("tr");
  const scheduleId = row.dataset.scheduleId;
  const status = row.querySelector(".review-status").value;
  const remark = row.querySelector(".review-remark").value.trim();
  button.disabled = true;
  showReviewNotice("");
  try {
    await fetchJson("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ scheduleId, status, remark })
    });
    showReviewNotice("审核已归档");
    await refreshData();
  } catch (error) {
    if (!handleAuthError(error)) showReviewNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function parseScheduleText(text) {
  const rows = String(text || "").replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.trim()).filter(Boolean)
    .map((line) => line.includes("\t") ? line.split("\t") : parseCsvLine(line));
  if (!rows.length) return [];

  const aliases = {
    center: ["中心", "所在中心"], week: ["周次", "周数"], weekday: ["星期", "周几"],
    shift: ["节次", "时间段", "值班时间"], name: ["值班人员", "姓名", "人员名单"],
    position: ["职位", "职务"], phone: ["联系电话", "电话", "手机号"]
  };
  const header = rows[0].map((value) => String(value).replace(/\s/g, ""));
  const findIndex = (names) => header.findIndex((value) => names.includes(value));
  const hasHeader = Object.values(aliases).some((names) => findIndex(names) >= 0);
  const valueAt = (cells, field, fallback) => {
    const index = hasHeader ? findIndex(aliases[field]) : fallback;
    return index >= 0 ? String(cells[index] || "").trim() : "";
  };

  const carried = {};
  return rows.slice(hasHeader ? 1 : 0).map((cells) => {
    const row = {
      center: valueAt(cells, "center", 0), week: valueAt(cells, "week", 1), weekday: valueAt(cells, "weekday", 2),
      shift: valueAt(cells, "shift", 3), name: valueAt(cells, "name", 4), position: valueAt(cells, "position", 5), phone: valueAt(cells, "phone", 6)
    };
    ["center", "week", "weekday", "shift"].forEach((field) => {
      if (row[field]) carried[field] = row[field];
      else row[field] = carried[field] || "";
    });
    return row;
  }).filter((row) => Object.values(row).some(Boolean));
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

async function importSchedules() {
  const schedules = parseScheduleText(schedulePaste.value);
  importSchedulesBtn.disabled = true;
  scheduleImportNotice.textContent = "正在归档...";
  try {
    const result = await fetchJson("/api/schedules", {
      method: "POST",
      body: JSON.stringify({ schedules })
    });
    schedulePaste.value = "";
    const warning = result.notTwoDuties?.length ? `；${result.notTwoDuties.length} 位同学的排班次数不是 2 次` : "";
    scheduleImportNotice.textContent = `已归档 ${result.count} 条固定排班${warning}`;
    await refreshData();
  } catch (error) {
    if (!handleAuthError(error)) scheduleImportNotice.textContent = error.message;
  } finally {
    importSchedulesBtn.disabled = false;
  }
}

async function startAdmin() {
  showAdmin();
  await Promise.all([refreshQr(), refreshData(), refreshDisplayUrl()]).catch((error) => {
    if (!handleAuthError(error)) showReviewNotice(error.message, true);
  });
  clearTimers();
  countdownTimer = setInterval(updateCountdown, 200);
  summaryTimer = setInterval(() => refreshData().catch((error) => !handleAuthError(error) && console.error(error)), 15000);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.classList.add("hidden");
  loginBtn.disabled = true;
  loginBtn.textContent = "正在进入...";
  try {
    const formData = new FormData(loginForm);
    await fetchJson("/api/admin-login", { method: "POST", body: JSON.stringify({ password: formData.get("password") }) });
    loginForm.reset();
    await startAdmin();
  } catch (error) {
    showLoginError(error.status ? error.message : "登录请求未到达后台，请检查部署状态。");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "进入后台";
  }
});

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}

togglePasswordBtn.addEventListener("click", () => {
  const visible = adminPassword.type === "text";
  adminPassword.type = visible ? "password" : "text";
  togglePasswordBtn.textContent = visible ? "显示" : "隐藏";
  togglePasswordBtn.setAttribute("aria-label", visible ? "显示密码" : "隐藏密码");
});

openDisplayBtn.addEventListener("click", () => {
  if (displayUrl) window.open(displayUrl, "_blank", "noopener");
});

copyDisplayLinkBtn.addEventListener("click", async () => {
  if (!displayUrl) return;
  try {
    await navigator.clipboard.writeText(displayUrl);
    copyDisplayLinkBtn.textContent = "已复制";
  } finally {
    setTimeout(() => { copyDisplayLinkBtn.textContent = "复制现场屏地址"; }, 1400);
  }
});

importSchedulesBtn.addEventListener("click", importSchedules);
refreshDataBtn.addEventListener("click", () => refreshData().catch((error) => !handleAuthError(error) && showReviewNotice(error.message, true)));
logoutBtn.addEventListener("click", async () => {
  await fetchJson("/api/admin-logout", { method: "POST" }).catch(() => {});
  showLogin("已退出后台。");
});

fetchJson("/api/admin-me").then(startAdmin).catch(() => showLogin());
