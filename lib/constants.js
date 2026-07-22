const centers = [
  "主席团",
  "精英团",
  "行政事务中心",
  "大数据中心",
  "市场拓展中心",
  "视频运营中心",
  "宣讲招聘中心",
  "培训中心",
  "职研中心",
  "青创中心",
  "新媒体中心"
];

const positions = [
  "团长",
  "精英团团长",
  "副团长",
  "主管",
  "副主管",
  "学生助理",
  "实习生"
];

const weeks = Array.from({ length: 20 }, (_, index) => index + 1);
const weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五"];
const dutyTypes = ["线下", "线上"];
const attendanceStatuses = ["正常", "调班", "迟到", "缺勤"];

const shifts = [
  { id: "s12", label: "一二节", start: "08:30", end: "10:10" },
  { id: "s34", label: "三四节", start: "10:30", end: "12:10" },
  { id: "s56", label: "五六节", start: "14:30", end: "16:10" },
  { id: "s78", label: "七八节", start: "16:30", end: "18:10" }
];

// 正式排班由管理员从总表导入；不在代码中预置任何同学的个人信息。
const seedSchedules = [];

module.exports = {
  attendanceStatuses,
  centers,
  dutyTypes,
  positions,
  seedSchedules,
  shifts,
  weekdays,
  weeks
};
