const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7P+UAAAAASUVORK5CYII=";
const nodes = new Map();
const node = () => ({ textContent: "", hidden: true, disabled: false, files: [],
  classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, focus() {}, scrollIntoView() {} });
let mode = "decode-error";
class Reader {
  readAsDataURL(file) { queueMicrotask(() => {
    if (mode === "read-timeout") return;
    if (mode === "read-error") { this.error = { message: "" }; this.onerror({ type: "error" }); }
    else { this.result = file.data || PNG; this.onload(); }
  }); }
  abort() { this.onabort?.(); }
}
class TestImage {
  constructor() { this.width = 1; this.height = 1; }
  set src(value) {
    if (!value) return;
    if (mode === "decode-timeout") return;
    queueMicrotask(() => mode === "decode-error" || mode === "large-decode-error"
      ? this.onerror({ type: "error" }) : this.onload());
  }
}
const context = vm.createContext({
  URLSearchParams, location: { search: "" }, FileReader: Reader, Image: TestImage,
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  document: {
    querySelector(key) { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); },
    createElement() { return { getContext: () => mode === "canvas-error" ? null : { drawImage() {} }, toDataURL: () => PNG }; }
  },
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)), clearTimeout,
  atob: value => Buffer.from(value, "base64").toString("binary"), AbortController,
  fetch: async () => { throw new Error("Unexpected network request"); }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "student.js"), "utf8"), context);
const file = { name: "camera.png", type: "image/png", size: 68, data: PNG };
(async () => {
  // 复现视频中的浏览器图片错误事件，修复后应保留可上传的原图。
  assert.equal(await context.photoToDataUrl(file), PNG);
  mode = "decode-timeout";
  assert.equal(await context.photoToDataUrl(file), PNG);
  mode = "canvas-error";
  assert.equal(await context.photoToDataUrl(file), PNG);
  mode = "success";
  assert.equal(await context.photoToDataUrl(file), PNG);
  mode = "read-error";
  await assert.rejects(context.photoToDataUrl(file), /照片.*读取|读取.*照片/);
  mode = "read-timeout";
  await assert.rejects(context.photoToDataUrl(file), /超时/);
  mode = "decode-error";
  await assert.rejects(context.photoToDataUrl({ ...file, data: "data:application/pdf;base64,JVBERi0xLjcK" }), /JPG|PNG|格式/);
  mode = "large-decode-error";
  await assert.rejects(context.photoToDataUrl({ ...file, size: 3 * 1024 * 1024, data: PNG + "A".repeat(4 * 1024 * 1024) }), /照片|重拍/);
  context.showError({ type: "error" });
  assert.ok(nodes.get("#submitError").textContent.trim());
  assert.notEqual(nodes.get("#submitError").textContent, "[object Object]");
  context.fetch = async () => ({ ok: false, json: async () => ({}) });
  await assert.rejects(context.fetchJson("/api/checkins"), /请求失败/);
  context.fetch = async () => ({ ok: true, json: async () => { throw new Error("Invalid JSON"); } });
  await assert.rejects(context.fetchJson("/api/checkins"), /服务暂时返回异常/);
  context.fetch = async () => ({ ok: true, json: async () => { throw { name: "AbortError" }; } });
  await assert.rejects(context.fetchJson("/api/checkins"), /网络请求超时.*暂未确认/);
  context.fetch = async () => { throw { type: "error" }; };
  await assert.rejects(context.fetchJson("/api/checkins"), /请求失败/);
  console.log("Photo decode fallback, canvas failure, read failure, invalid format, size limits and visible errors passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
