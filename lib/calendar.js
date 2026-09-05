const DAY_MS = 86400000;
const TIME_ZONE = "Asia/Shanghai";
const DAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const DEFAULT_CALENDAR = Object.freeze({ name: "2026 年秋季学期", startDate: "2026-09-07", weekCount: 20, timeZone: TIME_ZONE });

function dateNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error("学期起始日期不合法");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("学期起始日期不合法");
  return date.getTime();
}

function validateCalendar(value) {
  const name = String(value?.name || "").trim();
  const startDate = String(value?.startDate || "");
  const start = dateNumber(startDate);
  if (new Date(start).getUTCDay() !== 1) throw new Error("第一周起始日期必须是星期一");
  const weekCount = Number(value?.weekCount ?? 20);
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 20) throw new Error("学期周数须为 1 至 20");
  if (!name || name.length > 80) throw new Error("请填写不超过 80 字的学期名称");
  return { name, startDate, weekCount, timeZone: TIME_ZONE };
}

function chinaDate(now = new Date()) {
  return new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function scheduleDate(calendar, week, weekday) {
  const day = DAY_NAMES.indexOf(weekday);
  return new Date(dateNumber(calendar.startDate) + ((Number(week) - 1) * 7 + (day === 0 ? 6 : day - 1)) * DAY_MS).toISOString().slice(0, 10);
}

function calendarContext(calendar = DEFAULT_CALENDAR, now = new Date()) {
  const date = chinaDate(now);
  const dayNumber = dateNumber(date);
  const elapsed = Math.floor((dayNumber - dateNumber(calendar.startDate)) / DAY_MS);
  const week = Math.floor(elapsed / 7) + 1;
  const status = week < 1 ? "before" : week > calendar.weekCount ? "after" : "active";
  const weekday = DAY_NAMES[new Date(dayNumber).getUTCDay()];
  const weekRanges = Array.from({ length: calendar.weekCount }, (_, i) => ({
    week: i + 1, startDate: scheduleDate(calendar, i + 1, "星期一"), endDate: scheduleDate(calendar, i + 1, "星期日")
  }));
  return { ...calendar, date, weekday, week: status === "active" ? week : null, status,
    canSubmit: status === "active" && !["星期六", "星期日"].includes(weekday),
    message: status === "before" ? `学期尚未开始，第一周从 ${calendar.startDate} 开始` : status === "after" ? "本学期已结束" : `${date} ${weekday} · 第${week}周`,
    weekRanges, serverTime: new Date(now).toISOString() };
}

function checkinCalendar(calendar, now = new Date()) {
  const context = calendarContext(calendar, now);
  if (context.status !== "active") throw new Error(context.message);
  if (!context.canSubmit) throw new Error("当前为周末，尚未配置周末值班");
  return { week: context.week, weekday: context.weekday, dutyDate: context.date, semesterStartDate: calendar.startDate };
}

function belongsToCalendar(record, calendar) {
  if (record.semesterStartDate && record.semesterStartDate !== calendar.startDate) return false;
  const context = calendarContext(calendar, record.createdAt);
  return context.status === "active" && context.week === Number(record.week) && context.weekday === record.weekday;
}

module.exports = { DEFAULT_CALENDAR, TIME_ZONE, validateCalendar, calendarContext, chinaDate, scheduleDate, checkinCalendar, belongsToCalendar };
