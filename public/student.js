const params = new URLSearchParams(location.search);
const token = params.get("token");
const form = document.querySelector("#checkinForm");
const loadingNotice = document.querySelector("#loadingNotice");
const errorNotice = document.querySelector("#errorNotice");
const successNotice = document.querySelector("#successNotice");
const submitError = document.querySelector("#submitError");
const submitBtn = document.querySelector("#submitBtn");
const photoInput = document.querySelector("#photo");
const dutyTypeSelect = document.querySelector("#dutyType");
const swapDetailField = document.querySelector("#swapDetailField");
const swapTimeInput = document.querySelector("#swapTime");
const shiftChoices = document.querySelector("#shiftChoices");

let session = "";
let calendar = null;

function errorMessage(error, fallback = "提交未完成，请重新选择照片后重试。") {
  const message = typeof error === "string" ? error : error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

async function fetchJson(url, options = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 30000) : null;
  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" }, ...options,
      ...(controller ? { signal: controller.signal } : {})
    });
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error("服务暂时返回异常，请稍后重试。");
    }
    if (!response.ok || data?.ok === false) throw new Error(errorMessage(data?.reason, "请求失败，请稍后重试。"));
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("网络请求超时，暂未确认提交结果。请先联系管理员核对，避免重复提交。");
    if (error?.name === "TypeError") throw new Error("网络连接失败，请检查网络后重试。");
    throw new Error(errorMessage(error, "请求失败，请稍后重试。"));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function fillSelect(select, values) {
  select.innerHTML = ["<option value=\"\" selected disabled>请选择</option>", ...values.map((value) => `<option value="${value}">${value}</option>`)].join("");
}

function fillOptions(select, items) {
  select.innerHTML = ["<option value=\"\" selected disabled>请选择</option>", ...items.map((item) => `<option value="${item.value}">${item.label}</option>`)].join("");
}

function renderShiftChoices(items) {
  shiftChoices.replaceChildren(...items.map((item) => {
    const label = document.createElement("label");
    label.className = "shift-choice";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "shift";
    input.value = item.label;

    const text = document.createElement("span");
    const title = document.createElement("strong");
    const time = document.createElement("small");
    title.textContent = item.label;
    time.textContent = `${item.start}-${item.end}`;
    text.append(title, time);
    label.append(input, text);
    return label;
  }));
}

function renderOptions(options) {
  fillSelect(document.querySelector("#center"), options.centers);
  fillSelect(document.querySelector("#position"), options.positions);
  fillSelect(document.querySelector("#dutyType"), options.dutyTypes);
  renderShiftChoices(options.shifts);
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
  const target = fatal ? errorNotice : submitError;
  target.textContent = errorMessage(message);
  target.classList.remove("hidden");
  if (!fatal) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error("照片读取超时，请重新拍照后再提交。"));
      reader.abort();
    }, 15000);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error); else resolve(value);
    }
    reader.onload = () => finish(null, String(reader.result || ""));
    reader.onerror = () => finish(new Error("照片读取失败，请重新选择照片或重新拍照。"));
    reader.onabort = () => finish(new Error("照片读取已中断，请重新选择照片。"));
    try { reader.readAsDataURL(file); }
    catch { finish(new Error("照片读取失败，请重新选择照片或重新拍照。")); }
  });
}

function photoSource(value) {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/.exec(String(value));
  if (!match) throw new Error("照片内容无法读取，请重新拍照。");
  const encoded = match[1];
  const header = atob(encoded.slice(0, 32));
  let type = "";
  if (header.startsWith("\xFF\xD8\xFF")) type = "image/jpeg";
  else if (header.startsWith("\x89PNG\r\n\x1A\n")) type = "image/png";
  else if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") type = "image/webp";
  if (!type) throw new Error("照片格式暂不支持，请重新拍照或选择 JPG、PNG、WebP 图片。");
  const size = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  return { dataUrl: `data:${type};base64,${encoded}`, size };
}

async function photoToDataUrl(file) {
  if (!file || !file.size) throw new Error("照片为空，请重新拍照或选择照片。");
  if (file.size > 20 * 1024 * 1024) throw new Error("照片超过 20 MB，请选择较小的照片。");
  const original = photoSource(await fileToDataUrl(file));
  const maxUploadBytes = 2 * 1024 * 1024;
  let source;
  try {
    source = await fileToImage(original.dataUrl);
    const maxSize = 1280;
    const ratio = Math.min(1, maxSize / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("照片压缩暂不可用");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const compressed = photoSource(canvas.toDataURL("image/jpeg", 0.72));
    if (compressed.size <= maxUploadBytes) return compressed.dataUrl;
  } catch {
    // 部分手机无法解码或压缩相机照片，可识别的小原图仍可直接上传。
    if (original.size <= maxUploadBytes) return original.dataUrl;
  } finally {
    if (source) source.src = "";
  }
  if (original.size <= maxUploadBytes) return original.dataUrl;
  throw new Error("这张照片无法压缩且超过 2 MB，请重新拍照或选择较小的 JPG/PNG 照片。");
}

function fileToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeout = setTimeout(() => finish(new Error("照片处理超时")), 8000);
    function finish(error) {
      clearTimeout(timeout);
      img.onload = img.onerror = null;
      if (error) { img.src = ""; reject(error); } else resolve(img);
    }
    img.onload = () => finish();
    img.onerror = () => finish(new Error("当前浏览器无法解码这张照片"));
    try { img.src = dataUrl; } catch { finish(new Error("当前浏览器无法读取这张照片")); }
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
    const timing = await fetchJson("/api/calendar");
    calendar = timing.calendar;
    document.querySelector("#calendarDisplay").textContent = `${calendar.name} · ${calendar.message}`;
    submitBtn.disabled = !calendar.canSubmit;
    renderOptions(data.options);
    loadingNotice.classList.add("hidden");
    form.classList.remove("hidden");
  } catch (error) {
    showError(error, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitBtn.disabled) return;
  submitError.classList.add("hidden");
  errorNotice.classList.add("hidden");
  successNotice.classList.add("hidden");

  const formData = new FormData(form);
  const photo = photoInput.files[0];
  if (!photo) {
    showError("请上传一张值班照片。");
    return;
  }

  const selectedShifts = formData.getAll("shift").map(String).filter(Boolean);
  if (!calendar?.canSubmit || !selectedShifts.length) {
    showError(calendar?.canSubmit ? "请至少选择一个节次。" : calendar?.message || "暂时无法确定值班日期");
    return;
  }
  const dutyType = String(formData.get("dutyType") || "");
  const swapTime = String(formData.get("swapTime") || "").trim();
  if (dutyType === "调班" && !swapTime) {
    showError("选择调班时，请填写具体调班说明。");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "正在处理照片...";
  try {
    const photoDataUrl = await photoToDataUrl(photo);
    submitBtn.textContent = "正在上传...";
    const payload = {
      session,
      name: formData.get("name"),
      center: formData.get("center"),
      position: formData.get("position"),
      dutyType,
      swapTime,
      dutyDate: calendar.date,
      shifts: selectedShifts,
      attendanceType: formData.get("attendanceType"),
      photoName: photo.name,
      photoDataUrl
    };
    await fetchJson("/api/checkins", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    updateSwapDetails();
    successNotice.textContent = "提交成功，后台已记录本次签到签退。";
    successNotice.classList.remove("hidden");
    successNotice.focus({ preventScroll: true });
    successNotice.scrollIntoView({ block: "center" });
  } catch (error) {
    showError(error);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "提交签到签退";
  }
});

dutyTypeSelect.addEventListener("change", updateSwapDetails);
init();
