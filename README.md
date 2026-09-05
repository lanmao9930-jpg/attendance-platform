# 就业服务团值班考勤平台

这是一个面向就业服务团的值班签到签退平台，分成严格隔离的三类页面：

- `/display?key=...`：现场设备的二维码屏，只显示二维码。
- `/student?token=...`：学生扫码后的签到、签退与值班照片表单。
- `/admin`：管理员口令登录后的固定排班、考勤审核、原始归档和导出。

学生不会看到管理员入口、看板、排班、原始记录或导出；根地址 `/` 也不会展示管理入口。

## 本地预览

```powershell
cd C:\Users\ASUS\Documents\Codex\2026-06-11\files-mentioned-by-the-user-3\outputs\attendance-platform-vercel
npm install
$env:ADMIN_PASSWORD="仅用于本地预览的口令"
$env:QR_SECRET="至少32位的本地测试随机字符串"
$env:DISPLAY_TOKEN="现场屏测试密钥"
npm start
```

本地地址：

- 现场二维码屏：`http://localhost:8788/display?key=现场屏测试密钥`
- 管理端：`http://localhost:8788/admin`

## 验证

```powershell
npm run check
npm run test:unit
npm run test:integration
```

`npm run test:integration` 会自动启动一套隔离的临时服务并在结束后清理测试数据。需要手工联调时可使用：

```powershell
$env:PORT="8789"
$env:ADMIN_PASSWORD="仅用于本地测试的口令"
$env:QR_SECRET="local-test-secret-12345678901234567890"
$env:DISPLAY_TOKEN="display-test-key"
$env:ATTENDANCE_DATA_DIR=".test-data"
npm start
```

## 正式部署

正式环境已迁移至腾讯云 CloudBase：

- 管理端：`https://attendance-platform-d1b99a89a6e3.service.tcloudbase.com/admin`
- 现场屏：管理员登录后点击“打开现场屏”或“复制现场屏地址”
- 学生端：只通过现场动态二维码进入
- 学生表单：填写姓名、中心、职位、正常/调班、节次、签到/签退并上传照片；日期和周次由服务器按北京时间确定，节次可多选；调班必须填写具体说明
- 固定排班：管理端可上传 `.xlsx`、`.xls` 或 `.csv`，支持单中心文件、纵向明细和横向课表；文件和粘贴均按中心合并，新中心新增、同中心更新、其他中心保留，修改前快照可查看
- 学期日历：第一周从 2026-09-07 开始，导入时间不影响周次。新学期单独开启，旧排班和考勤保留
- 考勤审核：按周次和中心筛选，自动判断正常、迟到和学生申报调班；排班不匹配、缺少签到签退和提前签退会标红，人工复核可选择请假

正式管理员口令由随机值生成，只保存在被 Git 忽略的 `.env.local`，不要改回简单数字口令。

完整需求基线见 [docs/需求说明书.md](docs/需求说明书.md)，CloudBase 环境、数据集合、部署和验收记录见 [docs/CLOUDBASE上线交接.md](docs/CLOUDBASE上线交接.md)。Vercel 仅保留为历史测试和故障排查参考。
