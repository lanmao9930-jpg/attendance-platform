# 就业服务团值班考勤平台

这是一个面向就业服务团的值班签到签退平台，分成严格隔离的三类页面：

- `/display?key=...`：现场设备的二维码屏，只显示二维码。
- `/student?token=...`：学生扫码后的签到、签退与值班照片表单。
- `/admin`：管理员口令登录后的固定排班、考勤审核、原始归档和导出。

学生不会看到管理员入口、看板、排班、原始记录或导出；根地址 `/` 也不会展示管理入口。

## 本地预览

```powershell
cd C:\Users\ASUS\Documents\Codex\2026-06-11\files-mentioned-by-the-user-3\outputs\attendance-platform-vercel
pnpm install
$env:ADMIN_PASSWORD="12345678"
$env:QR_SECRET="至少32位的本地测试随机字符串"
$env:DISPLAY_TOKEN="现场屏测试密钥"
pnpm start
```

本地地址：

- 现场二维码屏：`http://localhost:8788/display?key=现场屏测试密钥`
- 管理端：`http://localhost:8788/admin`

## 验证

```powershell
pnpm check
node scripts\integration-test.js
```

集成测试默认检查 `http://localhost:8789`。启动该端口的测试服务时可使用：

```powershell
$env:PORT="8789"
$env:ADMIN_PASSWORD="12345678"
$env:QR_SECRET="local-test-secret-12345678901234567890"
$env:DISPLAY_TOKEN="display-test-key"
$env:ATTENDANCE_DATA_DIR=".test-data"
pnpm start
```

## 正式部署

完整需求基线见 [docs/需求说明书.md](docs/需求说明书.md)。Vercel 的根目录、Blob、环境变量、部署保护和 404 排查见 [docs/VERCEL上线交接.md](docs/VERCEL上线交接.md)。
