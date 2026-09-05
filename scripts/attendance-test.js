const assert = require("node:assert/strict");
const {
  activeScheduleRows,
  computeAttendance,
  findScheduleOccurrence,
  summarizeScheduleBatches
} = require("../lib/attendance");
const { shifts } = require("../lib/constants");

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

function checkin(id, createdAt, attendanceType, overrides = {}) {
  return {
    id,
    createdAt,
    center: schedule.center,
    week: 3,
    weekday: schedule.weekday,
    shifts: [schedule.shift],
    name: schedule.name,
    attendanceType,
    ...overrides
  };
}

function summary(checkins, now = "2026-03-02T03:00:00.000Z", reviews = []) {
  return computeAttendance({ schedules: [schedule], checkins, reviews }, { week: 3, now });
}

assert.deepEqual(shifts.map(({ start, end }) => [start, end]), [
  ["08:30", "10:10"],
  ["10:30", "12:10"],
  ["14:30", "16:10"],
  ["16:30", "18:10"]
]);

const onTime = summary([
  checkin("in-on-time", "2026-03-02T00:30:00.000Z", "签到"),
  checkin("out-on-time", "2026-03-02T02:10:00.000Z", "签退")
]);
assert.equal(onTime.rows[0].status, "正常");
assert.equal(onTime.rows[0].needsReview, false);
assert.match(onTime.rows[0].reason, /08:30/);

const late = summary([
  checkin("in-late", "2026-03-02T00:31:00.000Z", "签到"),
  checkin("out-late", "2026-03-02T02:10:00.000Z", "签退")
]);
assert.equal(late.rows[0].status, "迟到");
assert.equal(late.rows[0].needsReview, false);

const waitingForSignOut = summary([
  checkin("in-waiting", "2026-03-02T00:29:00.000Z", "签到")
], "2026-03-02T01:00:00.000Z");
assert.equal(waitingForSignOut.rows[0].status, "正常");
assert.equal(waitingForSignOut.rows[0].progress, "待签退");
assert.equal(waitingForSignOut.rows[0].needsReview, false);

const missingSignOut = summary([
  checkin("in-missing-out", "2026-03-02T00:29:00.000Z", "签到")
], "2026-03-02T02:11:00.000Z");
assert.equal(missingSignOut.rows[0].status, "异常");
assert.equal(missingSignOut.rows[0].needsReview, true);
assert.match(missingSignOut.rows[0].reason, /未找到签退/);

const earlySignOut = summary([
  checkin("in-early-out", "2026-03-02T00:29:00.000Z", "签到"),
  checkin("out-early", "2026-03-02T02:00:00.000Z", "签退")
]);
assert.equal(earlySignOut.rows[0].status, "异常");
assert.match(earlySignOut.rows[0].reason, /早于 10:10/);

const signOutOnly = summary([
  checkin("out-only", "2026-03-02T02:10:00.000Z", "签退")
]);
assert.equal(signOutOnly.rows[0].status, "异常");
assert.match(signOutOnly.rows[0].reason, /没有签到/);

const noRecords = summary([]);
assert.equal(noRecords.rows[0].status, "待核查");
assert.equal(noRecords.rows[0].needsReview, true);
assert.match(noRecords.rows[0].reason, /缺勤、调班、请假或填写错误/);

const mismatch = summary([
  checkin("wrong-weekday", "2026-03-03T00:29:00.000Z", "签到", { weekday: "星期二" })
]);
assert.equal(mismatch.rows[0].status, "待核查");
assert.equal(mismatch.unmatched.length, 1);
assert.equal(mismatch.unmatched[0].status, "异常");
assert.match(mismatch.unmatched[0].reason, /星期与固定排班不一致/);

const studentDeclaredSwap = summary([
  checkin("swap-in", "2026-03-03T02:30:00.000Z", "签到", {
    weekday: "星期二",
    shifts: ["三四节"],
    dutyType: "调班",
    abnormalType: "调班",
    swapTime: "原星期一一二节，与另一位同学互换为星期二三四节"
  }),
  checkin("swap-out", "2026-03-03T04:10:00.000Z", "签退", {
    weekday: "星期二",
    shifts: ["三四节"],
    dutyType: "调班",
    abnormalType: "调班",
    swapTime: "原星期一一二节，与另一位同学互换为星期二三四节"
  })
]);
assert.equal(studentDeclaredSwap.rows[0].status, "调班");
assert.equal(studentDeclaredSwap.rows[0].statusSource, "学生申报");
assert.equal(studentDeclaredSwap.rows[0].needsReview, false);
assert.equal(studentDeclaredSwap.rows[0].reviewable, true);
assert.equal(studentDeclaredSwap.unmatched.length, 0);

const secondSchedule = {
  ...schedule,
  id: "recurring-b",
  shift: "三四节"
};
const fullMorningCheckins = [
  checkin("multi-in", "2026-03-02T00:29:00.000Z", "签到", {
    shifts: ["一二节", "三四节"]
  }),
  checkin("multi-out", "2026-03-02T04:10:00.000Z", "签退", {
    shifts: ["一二节", "三四节"]
  })
];
const fullMorning = computeAttendance(
  { schedules: [schedule, secondSchedule], checkins: fullMorningCheckins, reviews: [] },
  { week: 3, now: "2026-03-02T04:10:00.000Z" }
);
assert.equal(fullMorning.rows.length, 2);
assert.deepEqual(fullMorning.rows.map((row) => row.status), ["正常", "正常"]);
assert.equal(fullMorning.unmatched.length, 0);

const partiallyMatched = computeAttendance(
  { schedules: [schedule], checkins: fullMorningCheckins, reviews: [] },
  { week: 3, now: "2026-03-02T04:10:00.000Z" }
);
assert.equal(partiallyMatched.rows[0].status, "正常");
assert.equal(partiallyMatched.unmatched.length, 2);
assert.deepEqual(partiallyMatched.unmatched.map((record) => record.shifts), [["三四节"], ["三四节"]]);

const secondOriginalSchedule = {
  ...secondSchedule,
  weekday: "星期二"
};
const multiShiftSwapCheckins = [
  checkin("multi-swap-in", "2026-03-04T06:29:00.000Z", "签到", {
    weekday: "星期三",
    shifts: ["五六节", "七八节"],
    dutyType: "调班",
    abnormalType: "调班",
    swapTime: "原星期一一二节和星期二三四节，调整为星期三五六节、七八节"
  }),
  checkin("multi-swap-out", "2026-03-04T10:10:00.000Z", "签退", {
    weekday: "星期三",
    shifts: ["五六节", "七八节"],
    dutyType: "调班",
    abnormalType: "调班",
    swapTime: "原星期一一二节和星期二三四节，调整为星期三五六节、七八节"
  })
];
const multiShiftSwap = computeAttendance(
  { schedules: [schedule, secondOriginalSchedule], checkins: multiShiftSwapCheckins, reviews: [] },
  { week: 3, now: "2026-03-04T10:10:00.000Z" }
);
assert.deepEqual(multiShiftSwap.rows.map((row) => row.status), ["调班", "调班"]);
assert.equal(multiShiftSwap.unmatched.length, 0);

const reviewed = summary([], undefined, [{
  scheduleId: "recurring-a__week_3",
  status: "请假",
  remark: "已核验请假手续"
}]);
assert.equal(reviewed.rows[0].status, "请假");
assert.equal(reviewed.rows[0].systemStatus, "待核查");
assert.equal(reviewed.rows[0].statusSource, "人工复核");
assert.equal(findScheduleOccurrence([schedule], "recurring-a__week_3").week, 3);
assert.equal(findScheduleOccurrence([schedule], "recurring-a__week_4"), null);

const weekFour = computeAttendance({ schedules: [schedule], checkins: [], reviews: [] }, { week: 4 });
assert.equal(weekFour.rows.length, 0);

const archivedSchedule = {
  ...schedule,
  id: "archived-a",
  batchId: "batch-old",
  batchName: "旧排班",
  isActive: false
};
const currentSchedule = {
  ...schedule,
  id: "current-a",
  batchId: "batch-current",
  batchName: "新排班",
  batchCreatedAt: "2026-03-01T00:00:00.000Z",
  isActive: true
};
assert.deepEqual(activeScheduleRows([archivedSchedule, currentSchedule]).map((item) => item.id), ["current-a"]);
const batchSummaries = summarizeScheduleBatches([archivedSchedule, currentSchedule]);
assert.equal(batchSummaries.length, 2);
assert.equal(batchSummaries[0].name, "新排班");
assert.equal(batchSummaries[0].isActive, true);

console.log(JSON.stringify({
  onTime: onTime.rows[0].status,
  oneMinuteLate: late.rows[0].status,
  missingSignOut: missingSignOut.rows[0].status,
  noRecords: noRecords.rows[0].status,
  mismatch: mismatch.unmatched[0].status,
  studentDeclaredSwap: studentDeclaredSwap.rows[0].status,
  multiShiftRows: fullMorning.rows.length,
  multiShiftSwapRows: multiShiftSwap.rows.length,
  reviewedStatus: reviewed.rows[0].status,
  scheduleBatches: batchSummaries.length
}));
