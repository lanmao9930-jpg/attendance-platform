const crypto = require("node:crypto");
const { DEFAULT_CALENDAR, validateCalendar } = require("./calendar");
const { activeScheduleRows, currentScheduleBatch, scheduleWeeks } = require("./attendance");

function initialPlanning() { return { revision: 0, calendar: { ...DEFAULT_CALENDAR }, imports: [], batchCalendars: {} }; }
function planningError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function identity(row) { return [row.center, row.studentNo || row.name, scheduleWeeks(row).join(","), row.weekday, row.shift].join("|"); }

function importImpact(existing, incoming) {
  return [...new Set(incoming.map(row => row.center))].map(center => ({ center,
    action: existing.some(row => row.center === center) ? "更新" : "新增",
    beforeCount: existing.filter(row => row.center === center).length,
    afterCount: incoming.filter(row => row.center === center).length }));
}

function planUpdate(db, state, body, rows, action = "import") {
  if (Number(body.expectedRevision) !== state.revision || body.expectedRevision === undefined) {
    throw planningError("排班或学期设置已变化，请刷新后重新确认导入", 409);
  }
  const active = activeScheduleRows(db.schedules);
  const currentBatch = currentScheduleBatch(active);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  let calendar = state.calendar;
  let schedules = active;
  const impact = action === "import" ? importImpact(active, rows) : [];
  if (action === "import") {
    if (body.mode && body.mode !== "replace-centers") throw planningError("普通导入只按中心更新；更换学期请使用“开启新学期”");
    if (!rows.length) throw planningError("没有可导入的排班");
    if (rows.some(row => scheduleWeeks(row).some(week => week > calendar.weekCount))) throw planningError("排班周次超出当前学期范围");
    const importedCenters = impact.map(item => item.center);
    for (const row of rows) {
      if (row.studentNo && active.some(old => old.studentNo === row.studentNo && old.center !== row.center && !importedCenters.includes(old.center))) {
        throw planningError(`学号 ${row.studentNo} 已属于其他中心，请核实后同时更新涉及的中心`);
      }
    }
    const oldByKey = new Map(active.map(row => [identity(row), row]));
    const batchId = currentBatch.id || state.batchId || crypto.randomUUID();
    schedules = [...active.filter(row => !importedCenters.includes(row.center)).map(row => ({ ...row, batchId, batchName: calendar.name, isActive: true })), ...rows.map(row => ({ ...row,
      id: oldByKey.get(identity(row))?.id || crypto.randomUUID(), batchId,
      batchName: calendar.name, batchCreatedAt: currentBatch.createdAt || now, isActive: true }))];
  } else {
    calendar = validateCalendar(body.calendar);
    if (action === "new-semester") {
      if (body.confirm !== true) throw planningError("开启新学期需要明确确认");
      if (calendar.startDate <= state.calendar.startDate) throw planningError("新学期起始日期必须晚于当前学期");
      schedules = [];
    } else if (action === "calendar") {
      if ((calendar.startDate !== state.calendar.startDate || calendar.weekCount !== state.calendar.weekCount)
        && (db.checkins || []).some(record => record.semesterStartDate === state.calendar.startDate)) {
        throw planningError("本学期已有正式考勤，不能重写日历；请使用开启新学期", 409);
      }
      if (active.some(row => scheduleWeeks(row).some(week => week > calendar.weekCount))) throw planningError("现有排班超出新的学期周数");
    } else throw planningError("操作不合法");
  }
  return { id, action, schedules, calendar, impact, sourceName: String(body.sourceName || "").trim().slice(0, 80), createdAt: now, expectedRevision: state.revision,
    before: { schedules: active, reviews: db.reviews || [], calendar: state.calendar },
    state: { ...state, revision: state.revision + 1, calendar,
      batchId: action === "new-semester" ? crypto.randomUUID() : (schedules[0]?.batchId || state.batchId || ""),
      batchCalendars: { ...state.batchCalendars, ...(currentBatch.id ? { [currentBatch.id]: state.calendar } : {}) } } };
}

module.exports = { initialPlanning, planUpdate, importImpact, planningError };
