# Vercel 上线交接

## 先处理当前 404

线上 `https://attendance-platform-delta.vercel.app/api/health` 仍返回“接口不存在”，而 GitHub 的 `main` 分支已经包含 `/api/health` 文件。这不是管理员密码错误，而是 Vercel 当前生产部署没有使用本项目根目录的最新代码。

在 Vercel 项目中执行：

1. 打开 **Settings -> General -> Root Directory**。
2. 根目录必须是 GitHub 仓库中同时含有 `api`、`public`、`vercel.json`、`package.json` 的目录。若仓库根目录就是本项目，留空或设为 `.`；不要填 `outputs/attendance-platform`、`public` 或其他旧目录。
3. 打开 **Settings -> Git**，确认 Production Branch 是 `main`。
4. 打开 **Deployments**，对最新 `main` 提交选择 **Redeploy**，并取消勾选“Use existing Build Cache”。
5. 部署完成后访问 `/api/health`。只有返回 `"ok": true` 才能继续测试登录和二维码。

## 项目配置

- Framework Preset：`Other`
- Build Command：留空或 `pnpm install`
- Output Directory：留空
- Install Command：`pnpm install`

在 **Settings -> Environment Variables** 逐项新建以下变量，并全部勾选 Production；需要预览环境时同时勾选 Preview。

| 名称 | 值 |
| --- | --- |
| `PUBLIC_BASE_URL` | `https://attendance-platform-delta.vercel.app` |
| `ADMIN_PASSWORD` | 管理员自定口令，例如当前的 `12345678` |
| `QR_SECRET` | 至少 32 位随机字符串 |
| `DISPLAY_TOKEN` | 现场屏专用随机字符串 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 连接项目后自动提供的读写令牌 |

变量界面里的“Key”是变量名，“Value”是你自己粘贴的值；这些不是下拉选项。每次新增或修改变量后都必须重新部署。

## Blob 存储

1. 打开 **Storage -> Create -> Blob**。
2. 创建后选择 **Connect to Project**，连接本项目。
3. 回到 Environment Variables，确认存在 `BLOB_READ_WRITE_TOKEN`。
4. 重新部署，在 `/api/health` 确认 `storageMode` 为 `vercel-blob`，且 `env.hasBlob` 为 `true`。

如果显示 `local-json`，线上数据和照片不能作为正式数据使用，必须先完成 Blob 连接。

## 关闭 Vercel 登录拦截

学生手机不能处理 Vercel 的登录页。打开 **Settings -> Deployment Protection**，Production 必须是 Public，或关闭 Vercel Authentication。完成后用手机流量访问现场屏地址验证，不要只用已登录 Vercel 的电脑验证。

## 正式地址分发

| 使用人 | 地址 | 分发方式 |
| --- | --- | --- |
| 现场设备 | `https://attendance-platform-delta.vercel.app/display?key=你的DISPLAY_TOKEN` | 只在现场设备打开，不发给学生 |
| 学生 | 无固定地址 | 只扫描现场二维码，自动进入表单 |
| 管理员 | `https://attendance-platform-delta.vercel.app/admin` | 只发给管理人员，再输入 `ADMIN_PASSWORD` |

根地址 `/` 只跳转二维码页，不显示管理员入口。二维码指向的学生页带有临时 token，不会指向管理端。

## 上线后的验收顺序

1. `/api/health` 返回 `ok: true`、`hasAdminPassword: true`、`hasQrSecret: true`、`hasBlob: true`。
2. 用无痕窗口打开 `/admin`：未登录时只能看到口令框；用正确口令能进入。
3. 用手机流量打开现场屏链接：必须直接显示二维码，不能出现 Vercel 登录。
4. 扫码：必须只显示姓名、中心、值班类型、周次/星期/节次、签到或签退、照片。
5. 管理员从 Excel 导入固定排班，进行一次签到和一次签退测试；后台应生成对应状态和照片链接。
6. 刷新页面和重新打开后台，数据仍存在；最后下载导出文件核对。
