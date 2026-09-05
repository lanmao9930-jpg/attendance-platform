const { centers, shifts, weeks } = require("./constants");
const { belongsToCalendar, scheduleDate, calendarContext } = require("./calendar");

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

function activeScheduleRows(schedules) {
  const rows = Array.isArray(schedules) ? schedules : [];
  const explicitlyActive = rows.filter((schedule) => schedule.isActive === true);
  if (explicitlyActive.length) return explicitlyActive;
  return rows.filter((schedule) => schedule.isActive !== false);
}

function currentScheduleBatch(schedules) {
  const active = activeScheduleRows(schedules);
  const metadata = active.find((schedule) => schedule.batchId);
  return {
    id: String(metadata?.batchId || ""),
    name: String(metadata?.batchName || "当前固定排班"),
    createdAt: String(metadata?.batchCreatedAt || ""),
    count: active.length
  };
}

function summarizeScheduleBatches(schedules) {
  const rows = Array.isArray(schedules) ? schedules : [];
  const activeIds = new Set(activeScheduleRows(rows).map((schedule) => schedule.id));
  const groups = new Map();

  rows.forEach((schedule) => {
    const isActive = activeIds.has(schedule.id);
    const key = schedule.batchId || (isActive ? "__current_legacy__" : "__archived_legacy__");
    if (!groups.has(key)) {
      groups.set(key, {
        id: schedule.batchId || "",
        name: schedule.batchName || (isActive ? "当前固定排班" : "历史固定排班"),
        createdAt: schedule.batchCreatedAt || schedule.importedAt || "",
        archivedAt: schedule.archivedAt || "",
        isActive,
        count: 0,
        centers: new Set(),
        people: new Set()
      });
    }
    const group = groups.get(key);
    group.isActive ||= isActive;
    group.count += 1;
    group.centers.add(schedule.center);
    group.people.add(`${schedule.center}|${schedule.name}`);
    if (!group.createdAt && schedule.importedAt) group.createdAt = schedule.importedAt;
    if (!group.archivedAt && schedule.archivedAt) group.archivedAt = schedule.archivedAt;
  });

  return [...groups.values()]
    .map((group) => ({
      id: group.id,
      name: group.name,
      createdAt: group.createdAt,
      archivedAt: group.archivedAt,
      isActive: group.isActive,
      count: group.count,
      centerCount: group.centers.size,
      peopleCount: group.people.size
    }))
    .sort((left, right) => (
      Number(right.isActive) - Number(left.isActive)
      || String(right.createdAt).localeCompare(String(left.createdAt))
    ));
}

function checkinBelongsToBatch(record, batch) {
  if (batch.id) return String(record.scheduleBatchId || "") === batch.id;
  return !record.scheduleBatchId;
}

function findScheduleOccurrence(schedules, id) {
  const active = activeScheduleRows(schedules);
  const direct = active.find((schedule) => schedule.id === id);
  if (direct && scheduleWeeks(direct).length === 1) {
    return { ...direct, templateId: direct.id, week: scheduleWeeks(direct)[0] };
  }
  const match = /^(.*)__week_(\d{1,2})$/.exec(String(id || ""));
  if (!match) return null;
  const schedule = active.find((item) => item.id === match[1]);
  const week = Number(match[2]);
  if (!schedule || !scheduleSupportsWeek(schedule, week)) return null;
  return { ...schedule, id, templateId: schedule.id, week };
}

function attendanceKey(item, shift) {
  return [item.center, item.week, item.weekday, shift, item.name].map((value) => String(value || "").trim()).join("|");
}

function recordShiftKey(record, shift) {
  return `${record.id}|${String(shift || "").trim()}`;
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

function isSwapRecord(record) {
  return record?.dutyType === "调班" || record?.abnormalType === "调班";
}

function personWeekKey(item) {
  return [item.center, item.week, item.name].map((value) => String(value || "").trim()).join("|");
}

function assignSwapRecords(checkins, occurrences, checkinIndex) {
  const groupsByPerson = new Map();
  checkins.filter(isSwapRecord).forEach((record) => {
    const personKey = personWeekKey(record);
    const actualKey = [
      personKey,
      record.weekday,
      [...(record.shifts || [])].sort().join("、")
    ].join("|");
    if (!groupsByPerson.has(personKey)) groupsByPerson.set(personKey, new Map());
    const actualGroups = groupsByPerson.get(personKey);
    if (!actualGroups.has(actualKey)) actualGroups.set(actualKey, []);
    actualGroups.get(actualKey).push(record);
  });

  const assignments = new Map();
  const matchedShiftKeys = new Set();
  groupsByPerson.forEach((actualGroups, personKey) => {
    const candidates = occurrences
      .filter((schedule) => personWeekKey(schedule) === personKey)
      .sort((left, right) => `${left.weekday}|${left.shift}`.localeCompare(`${right.weekday}|${right.shift}`, "zh-CN"));
    const usedScheduleIds = new Set();

    [...actualGroups.values()]
      .sort((left, right) => String(left[0]?.createdAt).localeCompare(String(right[0]?.createdAt)))
      .forEach((records) => {
        const actualShifts = [...new Set(records.flatMap((record) => record.shifts || []))];
        const availableCandidates = candidates.filter((schedule) => !usedScheduleIds.has(schedule.id));
        const exactCandidates = availableCandidates.filter((schedule) => records.some((record) => (
          record.weekday === schedule.weekday && (record.shifts || []).includes(schedule.shift)
        )));
        const declaration = records.map((record) => record.swapTime || record.remark || "").join(" ");
        const describedCandidates = availableCandidates.filter((schedule) => (
          declaration.includes(schedule.weekday) && declaration.includes(schedule.shift)
        ));
        const candidatesWithoutNormalRecord = availableCandidates.filter((schedule) => {
          const exact = checkinIndex.get(attendanceKey(schedule, schedule.shift)) || [];
          return !exact.some((record) => !isSwapRecord(record));
        });
        const orderedCandidates = [
          ...exactCandidates,
          ...describedCandidates,
          ...candidatesWithoutNormalRecord,
          ...availableCandidates
        ].filter((schedule, index, items) => items.findIndex((item) => item.id === schedule.id) === index);
        const targetCount = Math.min(Math.max(actualShifts.length, 1), availableCandidates.length);
        const targets = orderedCandidates.slice(0, targetCount);
        if (!targets.length) return;

        targets.forEach((target) => {
          usedScheduleIds.add(target.id);
          if (!assignments.has(target.id)) assignments.set(target.id, []);
          assignments.get(target.id).push(...records);
        });

        const matchedActualShifts = new Set();
        targets.forEach((target) => {
          if (records.some((record) => (
            record.weekday === target.weekday && (record.shifts || []).includes(target.shift)
          ))) {
            matchedActualShifts.add(target.shift);
          }
        });
        actualShifts.forEach((shift) => {
          if (matchedActualShifts.size < targets.length) matchedActualShifts.add(shift);
        });
        records.forEach((record) => {
          (record.shifts || [])
            .filter((shift) => matchedActualShifts.has(shift))
            .forEach((shift) => matchedShiftKeys.add(recordShiftKey(record, shift)));
        });
      });
  });
  return { assignments, matchedShiftKeys };
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
  const activeSchedules = activeScheduleRows(db.schedules);
  const activeBatch = currentScheduleBatch(db.schedules);
  const allCheckins = (db.checkins || []).filter((record) => checkinBelongsToBatch(record, activeBatch)
    && (!db.calendar || belongsToCalendar(record, db.calendar)));
  const checkins = allCheckins.filter((record) => (
    (!selectedWeek || Number(record.week) === selectedWeek)
    && (!selectedCenter || record.center === selectedCenter)
  ));
  const checkinIndex = indexCheckins(checkins);
  const reviewByScheduleId = new Map((db.reviews || []).map((review) => [review.scheduleId, review]));

  const schedules = selectedCenter
    ? activeSchedules.filter((schedule) => schedule.center === selectedCenter)
    : activeSchedules;
  const occurrences = expandSchedules(schedules, selectedWeek);
  const swapAssignmentResult = assignSwapRecords(checkins, occurrences, checkinIndex);
  const swapAssignments = swapAssignmentResult.assignments;
  const matchedRecordShiftKeys = new Set(swapAssignmentResult.matchedShiftKeys);
  const rows = occurrences.map((schedule) => {
    const exactRecords = checkinIndex.get(attendanceKey(schedule, schedule.shift)) || [];
    exactRecords.forEach((record) => matchedRecordShiftKeys.add(recordShiftKey(record, schedule.shift)));
    const relatedById = new Map([
      ...exactRecords,
      ...(swapAssignments.get(schedule.id) || [])
    ].map((record) => [record.id, record]));
    const related = [...relatedById.values()]
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    const signIns = related.filter((record) => record.attendanceType === "签到");
    const signOuts = related.filter((record) => record.attendanceType === "签退");
    const signIn = signIns[0];
    const signOut = signOuts.at(-1);
    const reportedSwap = related.find(isSwapRecord);
    const shift = shifts.find((item) => item.label === schedule.shift);
    const date = db.calendar ? scheduleDate(db.calendar, schedule.week, schedule.weekday) : "";
    const startsAt = date && shift ? new Date(`${date}T${shift.start}:00+08:00`) : null;
    const endsAt = date && shift ? new Date(`${date}T${shift.end}:00+08:00`) : null;
    let systemStatus = "待核查";
    let systemReason = "未找到签到或签退记录，需确认缺勤、调班、请假或填写错误";
    let needsReview = true;
    let progress = "未提交";

    if (reportedSwap) {
      systemStatus = "调班";
      systemReason = `学生申报调班：${reportedSwap.swapTime || reportedSwap.remark || "未填写详情"}`;
      needsReview = false;
      if (signIn && signOut) progress = "已完成";
      else if (signIn) progress = "待签退";
      else if (signOut) progress = "缺少签到";
    } else if (signIn && shift) {
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
    } else if (startsAt && now < startsAt) {
      systemStatus = "未开始";
      systemReason = `值班时间为 ${date} ${shift.start}-${shift.end}`;
      needsReview = false;
      progress = "未开始";
    } else if (endsAt && now < endsAt) {
      systemStatus = "待签到";
      systemReason = `尚未找到签到记录，值班于 ${shift.end} 结束`;
      needsReview = false;
      progress = "待签到";
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
      date,
      signOutTime: signOut?.createdAt || "",
      photoUploaded: related.some((record) => Boolean(record.photoName || record.photoUrl || record.photoDataUrl)),
      photoRecordId: related.find((record) => record.photoStored)?.id || "",
      dutyType: related.map((record) => record.dutyType).filter(Boolean).join("、"),
      status,
      reason,
      systemStatus,
      systemReason,
      statusSource: review ? "人工复核" : (reportedSwap ? "学生申报" : "系统初判"),
      needsReview: !review && needsReview,
      reviewable: Boolean(review) || needsReview || Boolean(reportedSwap),
      progress,
      reviewStatus: review?.status || "",
      reviewRemark: review?.remark || "",
      remark: related.map((record) => record.remark).filter(Boolean).join("；")
    };
  });

  const unmatched = checkins.flatMap((record) => {
    const unmatchedShifts = [...new Set(record.shifts || [])]
      .filter((shift) => !matchedRecordShiftKeys.has(recordShiftKey(record, shift)));
    if (!unmatchedShifts.length) return [];
    const unmatchedRecord = { ...record, shifts: unmatchedShifts };
    const reportedSwap = isSwapRecord(record);
    const mismatchReason = explainUnmatched(unmatchedRecord, occurrences);
    const partiallyMatched = unmatchedShifts.length < new Set(record.shifts || []).size;
    return [{
      ...unmatchedRecord,
      status: reportedSwap ? "调班" : "异常",
      statusSource: reportedSwap ? "学生申报" : "系统初判",
      needsReview: true,
      reason: reportedSwap
        ? `学生申报调班，${partiallyMatched ? "部分节次" : "所选节次"}未能关联本人固定排班：${record.swapTime || record.remark || mismatchReason}`
        : mismatchReason
    }];
  });
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { 正常: 0, 调班: 0, 请假: 0, 迟到: 0, 缺勤: 0, 异常: 0, 待核查: 0 });

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
    activeBatch,
    calendar: db.calendar ? calendarContext(db.calendar, now) : undefined,
    generatedAt: new Date().toISOString()
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(summary) {
  const headers = ["中心", "周次", "日期", "星期", "节次", "姓名", "职位", "值班类型", "签到时间", "签退时间", "是否上传照片", "考勤状态", "原因/备注"];
  const rows = summary.rows.map((row) => [
    row.center,
    `第${row.week}周`,
    row.date || "",
    row.weekday,
    row.shift,
    row.name,
    row.position,
    row.dutyType || "",
    row.signInTime ? new Date(row.signInTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "",
    row.signOutTime ? new Date(row.signOutTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "",
    row.photoUploaded ? "是" : "否",
    row.status,
    row.reason || row.remark || ""
  ]);
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

module.exports = {
  activeScheduleRows,
  buildCsv,
  checkinBelongsToBatch,
  computeAttendance,
  currentScheduleBatch,
  findScheduleOccurrence,
  scheduleSupportsWeek,
  scheduleWeeks,
  summarizeScheduleBatches
};
