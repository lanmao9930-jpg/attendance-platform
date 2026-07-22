const { centers, shifts, weeks } = require("./constants");

function minutesOf(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesFromIso(iso) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function scheduleWeeks(schedule) {
  const configured = Array.isArray(schedule?.weeks) ? schedule.weeks : [];
  const normalized = [...new Set(configured.map(Number).filter((week) => weeks.includes(week)))];
  if (normalized.length) return normalized;
  const exact = Number(schedule?.week || 0);
  return weeks.includes(exact) ? [exact] : [];
}

function scheduleSupportsWeek(schedule, week) {
  return scheduleWeeks(schedule).includes(Number(week));
}

function occurrenceId(schedule, week) {
  const configured = scheduleWeeks(schedule);
  if (configured.length === 1 && Number(schedule.week) === Number(week)) return schedule.id;
  return `${schedule.id}__week_${week}`;
}

function expandSchedules(schedules, selectedWeek = 0) {
  return (schedules || []).flatMap((schedule) => {
    const selected = Number(selectedWeek || 0);
    const activeWeeks = selected
      ? (scheduleSupportsWeek(schedule, selected) ? [selected] : [])
      : scheduleWeeks(schedule);
    return activeWeeks.map((week) => ({
      ...schedule,
      id: occurrenceId(schedule, week),
      templateId: schedule.id,
      week
    }));
  });
}

function findScheduleOccurrence(schedules, id) {
  const direct = (schedules || []).find((schedule) => schedule.id === id);
  if (direct && scheduleWeeks(direct).length === 1) {
    return { ...direct, templateId: direct.id, week: scheduleWeeks(direct)[0] };
  }
  const match = /^(.*)__week_(\d{1,2})$/.exec(String(id || ""));
  if (!match) return null;
  const schedule = (schedules || []).find((item) => item.id === match[1]);
  const week = Number(match[2]);
  if (!schedule || !scheduleSupportsWeek(schedule, week)) return null;
  return { ...schedule, id, templateId: schedule.id, week };
}

function attendanceKey(item, shift) {
  return [item.center, item.week, item.weekday, shift, item.name].map((value) => String(value || "").trim()).join("|");
}

function indexCheckins(checkins) {
  const index = new Map();
  checkins.forEach((record) => {
    (record.shifts || []).forEach((shift) => {
      const key = attendanceKey(record, shift);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(record);
    });
  });
  return index;
}

function computeAttendance(db, options = {}) {
  const selectedWeek = Number(options.week || 0);
  const selectedCenter = String(options.center || "").trim();
  const allCheckins = db.checkins || [];
  const checkins = allCheckins.filter((record) => (
    (!selectedWeek || Number(record.week) === selectedWeek)
    && (!selectedCenter || record.center === selectedCenter)
  ));
  const checkinIndex = indexCheckins(checkins);
  const reviewByScheduleId = new Map((db.reviews || []).map((review) => [review.scheduleId, review]));
  const matchedRecordIds = new Set();

  const schedules = selectedCenter
    ? (db.schedules || []).filter((schedule) => schedule.center === selectedCenter)
    : (db.schedules || []);
  const rows = expandSchedules(schedules, selectedWeek).map((schedule) => {
    const related = checkinIndex.get(attendanceKey(schedule, schedule.shift)) || [];
    related.forEach((record) => matchedRecordIds.add(record.id));
    const signIn = related.find((record) => record.attendanceType === "签到");
    const signOut = related.find((record) => record.attendanceType === "签退");
    const abnormal = related.find((record) => record.abnormalType && record.abnormalType !== "否");
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

    const review = reviewByScheduleId.get(schedule.id);
    if (review) {
      status = review.status;
      reason = review.remark || `管理员审核：${review.status}`;
    }

    return {
      ...schedule,
      signInTime: signIn?.createdAt || "",
      signOutTime: signOut?.createdAt || "",
      photoUploaded: related.some((record) => Boolean(record.photoName || record.photoUrl || record.photoDataUrl)),
      photoRecordId: related.find((record) => record.photoStored)?.id || "",
      dutyType: related.map((record) => record.dutyType).filter(Boolean).join("、"),
      status,
      reason,
      reviewStatus: review?.status || "",
      reviewRemark: review?.remark || "",
      remark: related.map((record) => record.remark).filter(Boolean).join("；")
    };
  });

  const unmatched = checkins.filter((record) => !matchedRecordIds.has(record.id));
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
    selectedWeek,
    selectedCenter,
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
  computeAttendance,
  findScheduleOccurrence,
  scheduleSupportsWeek,
  scheduleWeeks
};
