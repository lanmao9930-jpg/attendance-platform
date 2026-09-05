const { spawnSync } = require("node:child_process");
const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "-p", "@cloudbase/cli", "tcb", "fn", "detail", "attendance-platform", "--json"], { encoding: "utf8", shell: process.platform === "win32", windowsHide: true });
const output = result.stdout || "";
const begin = output.indexOf("{");
const end = output.lastIndexOf("}");
if (begin < 0) throw new Error("无法读取云函数元数据");
const parsed = JSON.parse(output.slice(begin, end + 1));
const data = parsed.data || parsed;
console.log(JSON.stringify({ keys: Object.keys(data), status: data.Status || data.status,
  runtime: data.Runtime || data.runtime, codeSize: data.CodeSize || data.codeSize,
  statusDesc: data.StatusDesc || data.statusDesc, initTimeout: data.InitTimeout,
  installDependency: data.InstallDependency }));
