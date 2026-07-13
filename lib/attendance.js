const { centers, shifts } = require("./constants");

function minutesOf(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesFromIso(iso) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function sameText(a, b) {
  return String(a || "").trim() === String(b || "").trim();
}

function sameWeek(recordWeek, scheduleWeek) {
  if (recordWeek === "" || recordWeek === null || recordWeek === undefined) return true;
  return Number(recordWeek) === Number(scheduleWeek);
}

function computeAttendance(db) {
  const checkins = db.checkins || [];
  const rows = (db.schedules || []).map((schedule) => {
    const related = checkins.filter((record) => (
      sameText(record.name, schedule.name)
      && sameText(record.center, schedule.center)
      && sameWeek(record.week, schedule.week)
      && sameText(record.weekday, schedule.weekday)
      && Array.isArray(record.shifts)
      && record.shifts.includes(schedule.shift)
    ));
    const signIn = related.find((r) => r.attendanceType === "签到");
    const signOut = related.find((r) => r.attendanceType === "签退");
    const abnormal = related.find((r) => r.abnormalType && r.abnormalType !== "否");
    let status = "缺勤";
    let reason = "未找到完整签到签退记录";

    if (abnormal && abnormal.abnormalType === "调班") {
      status = "调班";
      reason = abnormal.swapTime || abnormal.remark || "已提交调班说明";
    } else if (signIn && signOut) {
      const shift = shifts.find((item) => item.label === schedule.shift);
      const late = shift && minutesFromIso(signIn.createdAt) > minutesOf(shift.start) + 10;
      status = late ? "迟到" : "正常";
      reason = late ? `签到时间晚于 ${shift.start} 超过 10 分钟` : "签到签退完整";
    } else if (signIn || signOut) {
      status = "缺勤";
      reason = signIn ? "缺少签退记录" : "缺少签到记录";
    }

    return {
      ...schedule,
      signInTime: signIn?.createdAt || "",
      signOutTime: signOut?.createdAt || "",
      photoUploaded: related.some((r) => Boolean(r.photoName || r.photoUrl || r.photoDataUrl)),
      dutyType: related.map((r) => r.dutyType).filter(Boolean).join("、"),
      status,
      reason,
      remark: related.map((r) => r.remark).filter(Boolean).join("；")
    };
  });

  const unmatched = checkins.filter((record) => !rows.some((schedule) => (
    sameText(record.name, schedule.name)
    && sameText(record.center, schedule.center)
    && sameWeek(record.week, schedule.week)
    && sameText(record.weekday, schedule.weekday)
    && record.shifts?.includes(schedule.shift)
  )));

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { 正常: 0, 调班: 0, 迟到: 0, 缺勤: 0 });

  const centerStats = centers.map((center) => {
    const items = rows.filter((row) => row.center === center);
    const normal = items.filter((row) => row.status === "正常").length;
    return {
      center,
      total: items.length,
      normal,
      abnormal: items.length - normal,
      attendanceRate: items.length ? Math.round((normal / items.length) * 100) : 0
    };
  }).filter((item) => item.total > 0);

  return {
    rows,
    unmatched,
    counts,
    centerStats,
    totalSchedules: rows.length,
    totalCheckins: checkins.length,
    generatedAt: new Date().toISOString()
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(summary) {
  const headers = ["中心", "周次", "星期", "节次", "姓名", "职位", "值班类型", "签到时间", "签退时间", "是否上传照片", "考勤状态", "原因/备注"];
  const rows = summary.rows.map((row) => [
    row.center,
    `第${row.week}周`,
    row.weekday,
    row.shift,
    row.name,
    row.position,
    row.dutyType || "",
    row.signInTime ? new Date(row.signInTime).toLocaleString("zh-CN") : "",
    row.signOutTime ? new Date(row.signOutTime).toLocaleString("zh-CN") : "",
    row.photoUploaded ? "是" : "否",
    row.status,
    row.reason || row.remark || ""
  ]);
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

module.exports = {
  buildCsv,
  computeAttendance
};
