const assert = require("node:assert/strict");
const { computeAttendance, findScheduleOccurrence } = require("../lib/attendance");

const schedule = {
  id: "recurring-a",
  center: "行政事务中心",
  week: 0,
  weeks: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19],
  weekLabel: "单周",
  weekday: "星期一",
  shift: "一二节",
  name: "测试同学",
  position: "学生助理",
  phone: ""
};

const checkins = [
  {
    id: "in-3",
    createdAt: "2026-03-02T00:00:00.000Z",
    center: schedule.center,
    week: 3,
    weekday: schedule.weekday,
    shifts: [schedule.shift],
    name: schedule.name,
    attendanceType: "签到"
  },
  {
    id: "out-3",
    createdAt: "2026-03-02T02:00:00.000Z",
    center: schedule.center,
    week: 3,
    weekday: schedule.weekday,
    shifts: [schedule.shift],
    name: schedule.name,
    attendanceType: "签退"
  }
];

const weekThree = computeAttendance({ schedules: [schedule], checkins, reviews: [] }, { week: 3 });
assert.equal(weekThree.rows.length, 1);
assert.equal(weekThree.rows[0].id, "recurring-a__week_3");
assert.equal(weekThree.rows[0].status, "正常");

const weekFour = computeAttendance({ schedules: [schedule], checkins, reviews: [] }, { week: 4 });
assert.equal(weekFour.rows.length, 0);

const weekFive = computeAttendance({ schedules: [schedule], checkins, reviews: [] }, { week: 5 });
assert.equal(weekFive.rows.length, 1);
assert.equal(weekFive.rows[0].status, "缺勤");

const reviewed = computeAttendance({
  schedules: [schedule],
  checkins,
  reviews: [{ scheduleId: "recurring-a__week_3", status: "调班", remark: "已核验" }]
}, { week: 3 });
assert.equal(reviewed.rows[0].status, "调班");
assert.equal(findScheduleOccurrence([schedule], "recurring-a__week_3").week, 3);
assert.equal(findScheduleOccurrence([schedule], "recurring-a__week_4"), null);

console.log(JSON.stringify({
  recurringMatchedWeek: weekThree.rows[0].week,
  inactiveWeekRows: weekFour.rows.length,
  reviewedStatus: reviewed.rows[0].status
}));
