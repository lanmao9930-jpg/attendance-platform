# 就业服务团值班考勤平台 Vercel 部署版

这个目录是可部署到 Vercel 的版本。页面分入口，数据走同一套后端接口：

- `/display` 或 `/display.html`：现场二维码屏，只显示二维码。
- `/student?token=...`：学生扫码后的签到签退表单。
- `/admin` 或 `/admin.html`：管理员后台，需要口令登录。
- `/api/...`：后端接口，管理员数据接口强制校验登录。

## 本地预览

```powershell
cd C:\Users\ASUS\Documents\Codex\2026-06-11\files-mentioned-by-the-user-3\outputs\attendance-platform-vercel
C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd install
C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe local-server.js
```

也可以直接运行 `start-local.cmd`。

本地地址：

- 入口页：http://localhost:8788/
- 现场二维码屏：http://localhost:8788/display
- 管理后台：http://localhost:8788/admin
- 默认管理员口令：`admin123`

## 学生端问题

学生扫码后只会看到：

- 姓名
- 所在中心
- 值班类型：线下 / 线上
- 值班时间：周数、星期、时间段
- 签到 / 签退
- 值班照片，必填，浏览器会自动压缩后上传

学生端不会出现考勤看板、排班对比、原始记录、导出等后台内容。

## Vercel 环境变量

部署前在 Vercel Project Settings -> Environment Variables 添加：

```text
PUBLIC_BASE_URL=https://你的项目.vercel.app
ADMIN_PASSWORD=你的管理员口令
QR_SECRET=一串随机密钥，至少 32 位
DISPLAY_TOKEN=现场二维码屏密钥
BLOB_READ_WRITE_TOKEN=Vercel Blob 的读写 token
```

如果设置了 `DISPLAY_TOKEN`，现场屏幕地址要带 key：

```text
https://你的项目.vercel.app/display?key=你的现场二维码屏密钥
```

管理员也可以登录后台后打开二维码屏。学生扫码后只进入表单。

## Vercel 部署步骤

1. 把 `attendance-platform-vercel` 目录作为一个 GitHub 仓库推上去。
2. 登录 Vercel，选择 Add New Project。
3. 导入这个 GitHub 仓库。
4. Framework Preset 选 Other。
5. Build Command 留空或使用 `pnpm install`。
6. Output Directory 留空。
7. 添加上面的环境变量。
8. 在 Vercel Storage 里创建 Blob，并把 `BLOB_READ_WRITE_TOKEN` 配到环境变量。
9. Deploy。

## 存储说明

本地预览时使用 `data/attendance-db.json` 和 `data/photos/`。

部署到 Vercel 后，如果配置了 `BLOB_READ_WRITE_TOKEN`，系统会把考勤记录和照片存入 Vercel Blob。这个方案适合先跑通真实流程。后续如果记录量很大，再把记录迁移到 Neon/Supabase/Postgres，照片继续放对象存储。

## 权限边界

- `/display`：只展示二维码。
- `/student`：只提交签到数据。
- `/admin`：需要管理员口令。
- `/api/checkins` 的 GET、`/api/summary`、`/api/export.csv`：必须管理员登录。
- `/api/checkins` 的 POST：必须来自有效二维码扫码会话。

## 上线排查

公开健康检查：

```text
https://你的项目.vercel.app/api/health
```

如果 `hasAdminPassword` 是 `false`，说明 Vercel 没有读到 `ADMIN_PASSWORD`，后台密码会退回本地默认值 `admin123`。如果 `publicOrigin` 不是你的正式 Vercel 域名，检查 `PUBLIC_BASE_URL` 是否填成了类似 `https://你的项目.vercel.app`，不要带 `/admin`、`/display` 或其他路径。
