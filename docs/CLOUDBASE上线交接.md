# CloudBase 上线交接

## 当前正式环境

- 腾讯云环境：`attendance-platform-d1b99a89a6e3`
- 地域：上海 `ap-shanghai`
- 套餐：体验版，到期时间 `2027-01-19 23:59:59`
- HTTP 云函数：`attendance-platform`
- 正式域名：`https://attendance-platform-d1b99a89a6e3.service.tcloudbase.com`
- 管理端：`https://attendance-platform-d1b99a89a6e3.service.tcloudbase.com/admin`

现场屏没有公开固定地址。管理员登录后点击“打开现场屏”或“复制现场屏地址”，得到带现场密钥的 `/display?key=...` 地址；这个地址只放在现场设备，不发给学生。学生只扫描动态二维码进入 `/student?token=...`。

## 云端资源

平台使用一个 HTTP 云函数承载网页和 API，避免跨域与多项目配置。数据分开保存：

| 资源 | 用途 |
| --- | --- |
| `attendance_schedules` | 固定排班 |
| `attendance_reviews` | 管理员考勤状态与备注 |
| `attendance_checkins` | 原始签到签退记录 |
| 云存储 `photos/` | 值班照片 |

云存储权限已核实为“仅创建者及管理员可读写”。学生端不会获得照片文件 ID，查看照片必须经过已登录的 `/api/photo` 管理员接口。

## 部署配置

`cloudbaserc.json` 固定环境、函数类型、运行时和忽略文件。真实管理员口令与二维码签名密钥保存在被 Git 忽略的 `.env.local`，不会提交到仓库。

首次或重新部署：

```powershell
npx --yes -p @cloudbase/cli tcb fn deploy attendance-platform --httpFn --force --json
node scripts\cloudbase-setup.js route
```

仅首次创建数据集合：

```powershell
node scripts\cloudbase-setup.js collections
```

部署后只读验证：

```powershell
$env:CLOUDBASE_ADMIN_PASSWORD="管理员口令"
node scripts\cloudbase-smoke-test.js
```

不要重复运行带 `CLOUDBASE_WRITE_TEST=1` 的照片写入测试，除非同时按测试输出清理对应记录和照片。

## 已完成验收

2026-07-20 已完成以下线上检查：

1. `/api/health` 返回 `200`、版本 `0.3.0`、存储模式 `cloudbase`。
2. 未授权读取动态二维码返回 `401`。
3. 管理员口令登录成功，能读取空排班库和生成受保护的现场屏地址。
4. 动态二维码能换取学生表单会话。
5. 值班照片已实际上传 CloudBase 云存储，并能通过管理员接口读取。
6. 测试签到记录和测试照片已删除，正式库保持为空。
7. 使用手机微信浏览器标识请求学生页时直接返回表单，没有 Vercel 登录页或管理员内容。

真实手机仍应在正式使用前分别用校园 Wi-Fi 和手机流量扫码一次，这是对学校现场网络的最终验收，不涉及代码配置。

## 续期提醒

体验版不会自动续费。请在 `2026-12-19` 以后、`2027-01-19` 到期前进入 CloudBase 环境管理检查免费续期入口。不要主动升级付费套餐或开启按量付费；如免费政策发生变化，应先由学校决定是否承担费用。
