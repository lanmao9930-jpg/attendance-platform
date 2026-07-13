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

const shifts = [
  { id: "s12", label: "一二节", start: "08:00", end: "09:40" },
  { id: "s34", label: "三四节", start: "10:10", end: "11:50" },
  { id: "s56", label: "五六节", start: "14:30", end: "16:10" },
  { id: "s78", label: "七八节", start: "16:20", end: "18:00" }
];

const seedSchedules = [
  { id: "A001-1", week: 14, center: "行政事务中心", position: "主管", name: "谭信娇", phone: "15177122752", weekday: "星期一", shift: "一二节" },
  { id: "A001-2", week: 15, center: "行政事务中心", position: "主管", name: "谭信娇", phone: "15177122752", weekday: "星期四", shift: "五六节" },
  { id: "A002-1", week: 14, center: "行政事务中心", position: "副主管", name: "罗江杰", phone: "19111919462", weekday: "星期二", shift: "三四节" },
  { id: "A002-2", week: 15, center: "行政事务中心", position: "副主管", name: "罗江杰", phone: "19111919462", weekday: "星期五", shift: "七八节" },
  { id: "D001-1", week: 14, center: "大数据中心", position: "学生助理", name: "林知夏", phone: "13800000001", weekday: "星期三", shift: "一二节" },
  { id: "D001-2", week: 15, center: "大数据中心", position: "学生助理", name: "林知夏", phone: "13800000001", weekday: "星期五", shift: "三四节" },
  { id: "Q001-1", week: 14, center: "青创中心", position: "实习生", name: "陈序", phone: "13800000002", weekday: "星期一", shift: "五六节" },
  { id: "Q001-2", week: 15, center: "青创中心", position: "实习生", name: "陈序", phone: "13800000002", weekday: "星期三", shift: "七八节" }
];

module.exports = {
  centers,
  dutyTypes,
  positions,
  seedSchedules,
  shifts,
  weekdays,
  weeks
};
