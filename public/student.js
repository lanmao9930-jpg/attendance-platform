const params = new URLSearchParams(location.search);
const token = params.get("token");
const form = document.querySelector("#checkinForm");
const loadingNotice = document.querySelector("#loadingNotice");
const errorNotice = document.querySelector("#errorNotice");
const successNotice = document.querySelector("#successNotice");
const submitBtn = document.querySelector("#submitBtn");
const photoInput = document.querySelector("#photo");
const dutyTypeSelect = document.querySelector("#dutyType");
const swapDetailField = document.querySelector("#swapDetailField");
const swapTimeInput = document.querySelector("#swapTime");

let session = "";

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.reason || "请求失败");
  return data;
}

function fillSelect(select, values) {
  select.innerHTML = ["<option value=\"\" selected disabled>请选择</option>", ...values.map((value) => `<option value="${value}">${value}</option>`)].join("");
}

function fillOptions(select, items) {
  select.innerHTML = ["<option value=\"\" selected disabled>请选择</option>", ...items.map((item) => `<option value="${item.value}">${item.label}</option>`)].join("");
}

function renderOptions(options) {
  fillSelect(document.querySelector("#center"), options.centers);
  fillSelect(document.querySelector("#position"), options.positions);
  fillSelect(document.querySelector("#dutyType"), options.dutyTypes);
  fillOptions(document.querySelector("#week"), options.weeks.map((week) => ({ value: week, label: `第${week}周` })));
  fillSelect(document.querySelector("#weekday"), options.weekdays);
  fillOptions(document.querySelector("#shift"), options.shifts.map((shift) => ({ value: shift.label, label: shift.label })));
}

function updateSwapDetails() {
  const isSwap = dutyTypeSelect.value === "调班";
  swapDetailField.classList.toggle("hidden", !isSwap);
  swapTimeInput.required = isSwap;
  if (!isSwap) swapTimeInput.value = "";
}

function showError(message, fatal = false) {
  loadingNotice.classList.add("hidden");
  if (fatal) form.classList.add("hidden");
  errorNotice.textContent = message;
  errorNotice.classList.remove("hidden");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function photoToDataUrl(file) {
  if (!file || !file.type.startsWith("image/")) return fileToDataUrl(file);
  const source = await fileToImage(file);
  const maxSize = 1280;
  const ratio = Math.min(1, maxSize / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * ratio));
  const height = Math.max(1, Math.round(source.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function init() {
  if (!token) {
    showError("缺少二维码参数，请回到现场重新扫码。", true);
    return;
  }
  try {
    const data = await fetchJson("/api/open-checkin", {
      method: "POST",
      body: JSON.stringify({ token })
    });
    session = data.session;
    renderOptions(data.options);
    loadingNotice.classList.add("hidden");
    form.classList.remove("hidden");
  } catch (error) {
    showError(error.message, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorNotice.classList.add("hidden");
  successNotice.classList.add("hidden");

  const formData = new FormData(form);
  const photo = photoInput.files[0];
  if (!photo) {
    showError("请上传一张值班照片。");
    return;
  }

  const week = Number(formData.get("week"));
  const weekday = String(formData.get("weekday") || "");
  const shift = String(formData.get("shift") || "");
  if (!week || !weekday || !shift) {
    showError("请选择值班时间。");
    return;
  }
  const dutyType = String(formData.get("dutyType") || "");
  const swapTime = String(formData.get("swapTime") || "").trim();
  if (dutyType === "调班" && !swapTime) {
    showError("选择调班时，请填写具体调班说明。");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "正在提交...";
  try {
    const payload = {
      session,
      name: formData.get("name"),
      center: formData.get("center"),
      position: formData.get("position"),
      dutyType,
      swapTime,
      week,
      weekday,
      shifts: [shift],
      attendanceType: formData.get("attendanceType"),
      photoName: photo.name,
      photoDataUrl: await photoToDataUrl(photo)
    };
    await fetchJson("/api/checkins", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    updateSwapDetails();
    successNotice.textContent = "提交成功，后台已记录本次签到签退。";
    successNotice.classList.remove("hidden");
  } catch (error) {
    errorNotice.textContent = error.message;
    errorNotice.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "提交签到签退";
  }
});

dutyTypeSelect.addEventListener("change", updateSwapDetails);
init();
