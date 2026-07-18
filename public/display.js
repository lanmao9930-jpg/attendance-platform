const displayQrImage = document.querySelector("#displayQrImage");
const displayError = document.querySelector("#displayError");
const displayKey = new URLSearchParams(location.search).get("key") || "";

let currentQr = null;

async function fetchJson(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  const data = await response.json().catch(() => ({ reason: "请求失败" }));
  if (!response.ok) {
    const error = new Error(data.reason || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

function showDisplayError(message) {
  displayError.textContent = message;
  displayError.classList.remove("hidden");
  displayQrImage.classList.add("hidden");
}

async function refreshQr() {
  const query = displayKey ? `?displayKey=${encodeURIComponent(displayKey)}` : "";
  const data = await fetchJson(`/api/current-qr${query}`);
  displayError.classList.add("hidden");
  displayQrImage.classList.remove("hidden");
  if (!currentQr || currentQr.token !== data.token) {
    currentQr = data;
    displayQrImage.src = `${data.qrSvgUrl}&t=${Date.now()}`;
  }
}

function updateCountdown() {
  if (!currentQr) return;
  const left = Math.max(0, currentQr.expiresAt - Date.now());
  if (left <= 150) {
    refreshQr().catch((error) => {
      showDisplayError(error.status === 401 ? "现场二维码屏未授权，请检查 display key。" : error.message);
    });
  }
}

refreshQr().catch((error) => {
  showDisplayError(error.status === 401 ? "现场二维码屏未授权，请检查 display key。" : error.message);
});
setInterval(updateCountdown, 200);
