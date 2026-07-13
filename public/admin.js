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
const copyLinkBtn = document.querySelector("#copyLinkBtn");
const refreshDataBtn = document.querySelector("#refreshDataBtn");
const logoutBtn = document.querySelector("#logoutBtn");

let currentQr = null;
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
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({ reason: "请求失败" }));
  if (!response.ok) {
    const error = new Error(data.reason || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}

function clearTimers() {
  if (countdownTimer) clearInterval(countdownTimer);
  if (summaryTimer) clearInterval(summaryTimer);
  countdownTimer = null;
  summaryTimer = null;
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

function handleAuthError(error) {
  if (error.status === 401) {
    showLogin("管理员登录已过期，请重新输入口令。");
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

function statusClass(status) {
  return {
    "正常": "ok",
    "调班": "swap",
    "迟到": "late",
    "缺勤": "miss"
  }[status] || "miss";
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "";
}

function renderBars(target, rows, valueKey, labelKey) {
  target.innerHTML = rows.length ? rows.map((row) => {
    const value = Number(row[valueKey] || 0);
    return `
      <div class="bar-row">
        <span>${row[labelKey]}</span>
        <div class="bar-track"><span style="width:${Math.max(4, value)}%"></span></div>
        <strong>${value}%</strong>
      </div>
    `;
  }).join("") : `<p class="muted">暂无数据</p>`;
}

function renderCountBars(target, counts) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
  const rows = Object.entries(counts).map(([label, count]) => ({
    label,
    percent: Math.round((count / total) * 100)
  }));
  renderBars(target, rows, "percent", "label");
}

async function refreshSummary() {
  const [summary, raw] = await Promise.all([
    fetchJson("/api/summary"),
    fetchJson("/api/checkins")
  ]);

  document.querySelector("#metricSchedules").textContent = summary.totalSchedules;
  document.querySelector("#metricCheckins").textContent = summary.totalCheckins;
  document.querySelector("#metricNormal").textContent = summary.counts["正常"] || 0;
  document.querySelector("#metricAbnormal").textContent = summary.totalSchedules - (summary.counts["正常"] || 0);
  document.querySelector("#summaryTime").textContent = `生成时间：${formatTime(summary.generatedAt)}`;

  renderBars(document.querySelector("#centerBars"), summary.centerStats, "attendanceRate", "center");
  renderCountBars(document.querySelector("#statusBars"), summary.counts);

  document.querySelector("#compareBody").innerHTML = summary.rows.map((row) => `
    <tr>
      <td>${row.center}</td>
      <td>第${row.week}周</td>
      <td>${row.weekday}</td>
      <td>${row.shift}</td>
      <td>${row.name}</td>
      <td>${formatTime(row.signInTime)}</td>
      <td>${formatTime(row.signOutTime)}</td>
      <td>${row.photoUploaded ? "是" : "否"}</td>
      <td><span class="status ${statusClass(row.status)}">${row.status}</span></td>
      <td>${row.reason || ""}</td>
    </tr>
  `).join("");

  document.querySelector("#recordsBody").innerHTML = raw.checkins.map((record) => `
    <tr>
      <td>${formatTime(record.createdAt)}</td>
      <td>${record.name}</td>
      <td>${record.center}</td>
      <td>${record.week ? `第${record.week}周` : ""}</td>
      <td>${record.weekday}</td>
      <td>${(record.shifts || []).join("、")}</td>
      <td>${record.dutyType || ""}</td>
      <td>${record.attendanceType}</td>
      <td>${record.abnormalType}</td>
      <td>${record.remark || record.swapTime || ""}</td>
    </tr>
  `).join("");
}

async function startAdmin() {
  showAdmin();
  await refreshQr().catch((error) => {
    if (!handleAuthError(error)) qrCountdownText.textContent = error.message;
  });
  await refreshSummary().catch((error) => {
    if (!handleAuthError(error)) console.error(error);
  });
  clearTimers();
  countdownTimer = setInterval(updateCountdown, 200);
  summaryTimer = setInterval(() => {
    refreshSummary().catch((error) => {
      if (!handleAuthError(error)) console.error(error);
    });
  }, 5000);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.classList.add("hidden");
  loginBtn.disabled = true;
  loginBtn.textContent = "正在进入...";
  try {
    const formData = new FormData(loginForm);
    await fetchJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: formData.get("password") })
    });
    loginForm.reset();
    await startAdmin();
  } catch (error) {
    showLoginError(error.status ? error.message : "登录请求没有到达后台，请检查 Vercel 部署保护、环境变量或 API 是否部署成功。");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "进入后台";
  }
});

togglePasswordBtn.addEventListener("click", () => {
  const visible = adminPassword.type === "text";
  adminPassword.type = visible ? "password" : "text";
  togglePasswordBtn.textContent = visible ? "显示" : "隐藏";
});

copyLinkBtn.addEventListener("click", async () => {
  if (!currentQr) return;
  await navigator.clipboard.writeText(currentQr.checkinUrl);
  copyLinkBtn.textContent = "已复制";
  setTimeout(() => {
    copyLinkBtn.textContent = "复制当前签到链接";
  }, 1400);
});

refreshDataBtn.addEventListener("click", () => {
  refreshSummary().catch((error) => {
    if (!handleAuthError(error)) console.error(error);
  });
});

logoutBtn.addEventListener("click", async () => {
  await fetchJson("/api/admin/logout", { method: "POST" }).catch(console.error);
  showLogin("已退出后台。");
});

fetchJson("/api/admin/me")
  .then(startAdmin)
  .catch(() => showLogin());
