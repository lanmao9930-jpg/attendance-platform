const { centers, shifts, weeks } = require("./constants");

function minutesOf(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function shanghaiDateTime(iso) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: hour * 60 + minute
  };
}

function minutesFromIso(iso) {
  return shanghaiDateTime(iso).minutes;
}

function shiftEndedSince(signInIso, end, now) {
  const signIn = shanghaiDateTime(signInIso);
  const current = shanghaiDateTime(now);
  if (current.dateKey !== signIn.dateKey) return current.dateKey > signIn.dateKey;
  return current.minutes >= minutesOf(end);
}

function signOutBeforeEnd(signInIso, signOutIso, end) {
  const signIn = shanghaiDateTime(signInIso);
  const signOut = shanghaiDateTime(signOutIso);
  if (signOut.dateKey !== signIn.dateKey) return signOut.dateKey < signIn.dateKey;
  return signOut.minutes < minutesOf(end);
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

function listValues(items, getter) {
  return [...new Set(items.map(getter).filter(Boolean))].join("、");
}

function explainUnmatched(record, occurrences) {
  const active = occurrences.filter((schedule) => Number(schedule.week) === Number(record.week));
  const sameName = active.filter((schedule) => schedule.name === record.name);
  if (sameName.length) {
    const reasons = [];
    if (!sameName.some((schedule) => schedule.center === record.center)) {
      reasons.push(`中心与固定排班不一致（固定排班：${listValues(sameName, (item) => item.center)}）`);
    }
    const sameCenter = sameName.filter((schedule) => schedule.center === record.center);
    const centerCandidates = sameCenter.length ? sameCenter : sameName;
    if (!centerCandidates.some((schedule) => schedule.weekday === record.weekday)) {
      reasons.push(`星期与固定排班不一致（固定排班：${listValues(centerCandidates, (item) => item.weekday)}）`);
    }
    const sameDay = centerCandidates.filter((schedule) => schedule.weekday === record.weekday);
    const dayCandidates = sameDay.length ? sameDay : centerCandidates;
    if (!dayCandidates.some((schedule) => (record.shifts || []).includes(schedule.shift))) {
      reasons.push(`节次与固定排班不一致（固定排班：${listValues(dayCandidates, (item) => item.shift)}）`);
    }
    if (reasons.length) return reasons.join("；");
  }

  const sameSlot = active.filter((schedule) => (
    schedule.center === record.center
    && schedule.weekday === record.weekday
    && (record.shifts || []).includes(schedule.shift)
  ));
  if (sameSlot.length) {
    return `姓名与该时段固定排班不一致（固定排班：${listValues(sameSlot, (item) => item.name)}）`;
  }

  const sameCenter = active.filter((schedule) => schedule.center === record.center);
  if (sameCenter.length) return `填写的星期或节次与${record.center}第${record.week}周固定排班不一致`;
  if (active.length) return `姓名或中心与第${record.week}周固定排班不一致`;
  return `第${record.week}周没有可匹配的固定排班`;
}

function computeAttendance(db, options = {}) {
  const selectedWeek = Number(options.week || 0);
  const selectedCenter = String(options.center || "").trim();
  const now = options.now ? new Date(options.now) : new Date();
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
  const occurrences = expandSchedules(schedules, selectedWeek);
  const rows = occurrences.map((schedule) => {
    const related = [...(checkinIndex.get(attendanceKey(schedule, schedule.shift)) || [])]
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    related.forEach((record) => matchedRecordIds.add(record.id));
    const signIns = related.filter((record) => record.attendanceType === "签到");
    const signOuts = related.filter((record) => record.attendanceType === "签退");
    const signIn = signIns[0];
    const signOut = signOuts.at(-1);
    const reportedSwap = related.find((record) => record.abnormalType === "调班");
    const shift = shifts.find((item) => item.label === schedule.shift);
    let systemStatus = "待核查";
    let systemReason = "未找到签到或签退记录，需确认缺勤、调班或填写错误";
    let needsReview = true;
    let progress = "未提交";

    if (signIn && shift) {
      const late = minutesFromIso(signIn.createdAt) > minutesOf(shift.start);
      systemStatus = late ? "迟到" : "正常";
      systemReason = late
        ? `签到时间晚于 ${shift.start}`
        : `签到时间不晚于 ${shift.start}`;
      needsReview = false;
      progress = "待签退";

      if (signOut) {
        progress = "已完成";
        if (signOutBeforeEnd(signIn.createdAt, signOut.createdAt, shift.end)) {
          systemStatus = "异常";
          systemReason = `签退时间早于 ${shift.end}，需核查`;
          needsReview = true;
        } else {
          systemReason += `；已在 ${shift.end} 后签退`;
        }
      } else if (shiftEndedSince(signIn.createdAt, shift.end, now)) {
        systemStatus = "异常";
        systemReason = `已过 ${shift.end} 仍未找到签退记录`;
        needsReview = true;
        progress = "缺少签退";
      } else {
        systemReason += `；等待 ${shift.end} 签退`;
      }
    } else if (signOut) {
      systemStatus = "异常";
      systemReason = "找到签退但没有签到记录，需核查填写或调班情况";
      needsReview = true;
      progress = "缺少签到";
    }

    if (reportedSwap) {
      systemStatus = "异常";
      systemReason = `提交了调班说明，需主管复核：${reportedSwap.swapTime || reportedSwap.remark || "未填写详情"}`;
      needsReview = true;
    }

    const review = reviewByScheduleId.get(schedule.id);
    let status = systemStatus;
    let reason = systemReason;
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
      systemStatus,
      systemReason,
      statusSource: review ? "人工复核" : "系统初判",
      needsReview: !review && needsReview,
      reviewable: Boolean(review) || needsReview,
      progress,
      reviewStatus: review?.status || "",
      reviewRemark: review?.remark || "",
      remark: related.map((record) => record.remark).filter(Boolean).join("；")
    };
  });

  const unmatched = checkins.filter((record) => !matchedRecordIds.has(record.id)).map((record) => ({
    ...record,
    status: "异常",
    needsReview: true,
    reason: explainUnmatched(record, occurrences)
  }));
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { 正常: 0, 调班: 0, 迟到: 0, 缺勤: 0, 异常: 0, 待核查: 0 });

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
