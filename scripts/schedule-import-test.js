const assert = require("node:assert/strict");
const fs = require("node:fs");
const XLSX = require("xlsx");
const { parseScheduleWorkbook } = require("../lib/schedule-import");

function workbookDataUrl(rows, sheetName = "固定排班") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`;
}

const parsed = parseScheduleWorkbook({
  fileName: "腾讯文档固定排班.xlsx",
  fileDataUrl: workbookDataUrl([
    ["行政事务中心固定排班"],
    [],
    ["周数", "周几", "值班时间", "人员名单", "职务", "手机号"],
    ["第2周", "周二", "1-2节", "张三、李四", "学生助理", "13800000000"],
    ["第8周", "星期五", "五六节", "王五", "副主管", "13900000000"]
  ])
});

assert.equal(parsed.schedules.length, 3);
assert.equal(parsed.peopleCount, 3);
assert.equal(parsed.issueCount, 0);
assert.ok(parsed.schedules.every((row) => row.center === "行政事务中心"));
assert.deepEqual(parsed.schedules.slice(0, 2).map((row) => row.name), ["张三", "李四"]);
assert.equal(parsed.schedules[0].week, 2);
assert.equal(parsed.schedules[0].weekday, "星期二");
assert.equal(parsed.schedules[0].shift, "一二节");

const carried = parseScheduleWorkbook({
  fileName: "合并单元格导出.xlsx",
  fileDataUrl: workbookDataUrl([
    ["所在中心", "周次", "星期", "节次", "姓名", "职位", "联系电话"],
    ["行政中心", "第3周", "星期三", "三四节", "赵六", "主管", "13600000000"],
    ["", "", "", "", "钱七", "学生助理", "13700000000"]
  ])
});
assert.equal(carried.schedules.length, 2);
assert.ok(carried.schedules.every((row) => row.center === "行政事务中心"));
assert.ok(carried.schedules.every((row) => row.week === 3 && row.weekday === "星期三" && row.shift === "三四节"));

const questionnaire = parseScheduleWorkbook({
  fileName: "问卷收集结果.xlsx",
  fileDataUrl: workbookDataUrl([
    ["姓名（请填写）", "所在中心（请选择）", "值班时间（周次、星期、节次）"],
    ["孙八", "行政事务中心", "第4周 周四 7-8节"]
  ], "腾讯问卷导出")
});
assert.equal(questionnaire.schedules.length, 1);
assert.equal(questionnaire.schedules[0].week, 4);
assert.equal(questionnaire.schedules[0].weekday, "星期四");
assert.equal(questionnaire.schedules[0].shift, "七八节");

const samplePath = "C:/Users/ASUS/Downloads/就业服务团值班考勤行政汇总样表 (3) - 副本.xlsx";
if (fs.existsSync(samplePath)) {
  const buffer = fs.readFileSync(samplePath);
  const sample = parseScheduleWorkbook({
    fileName: samplePath,
    fileDataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`
  });
  assert.equal(sample.schedules.length, 0);
  assert.equal(sample.sheetSummaries.length, 2);
  assert.equal(sample.sheetSummaries[0].headerRow, 3);
  assert.doesNotMatch(JSON.stringify(sample), /中心名称包含多个中心/);
}

console.log(JSON.stringify({
  titleCenterRows: parsed.schedules.length,
  carriedMergedRows: carried.schedules.length,
  questionnaireRows: questionnaire.schedules.length,
  sampleWorkbookChecked: fs.existsSync(samplePath)
}));
