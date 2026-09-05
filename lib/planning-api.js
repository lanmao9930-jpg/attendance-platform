const { json, readJson, methodNotAllowed } = require("./http");
const { requireAdmin } = require("./security");
const { loadDb, loadPlanningState, commitPlanning, loadImportSnapshots } = require("./store");
const { calendarContext } = require("./calendar");
const { planUpdate, importImpact } = require("./planning");

async function handlePlanningApi(req, res, pathname, url, normalizeSchedules) {
  if (!["/api/calendar", "/api/semester", "/api/schedule-imports"].includes(pathname)
    && !(pathname === "/api/schedules" && req.method === "POST")) return false;
  try {
    if (pathname === "/api/calendar") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const state = await loadPlanningState();
      json(res, 200, { calendar: calendarContext(state.calendar), revision: state.revision });
      return true;
    }
    const admin = await requireAdmin(req, res);
    if (!admin) return true;
    if (pathname === "/api/schedule-imports") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const id = url.searchParams.get("id");
      const data = await loadImportSnapshots(id);
      json(res, data ? 200 : 404, data ? (id ? data : { imports: data }) : { reason: "导入快照不存在" });
      return true;
    }
    if (pathname === "/api/semester" && req.method === "GET") {
      const state = await loadPlanningState();
      json(res, 200, { calendar: calendarContext(state.calendar), revision: state.revision });
      return true;
    }
    if (req.method !== "POST") { methodNotAllowed(res, ["GET", "POST"]); return true; }
    const body = await readJson(req);
    const state = await loadPlanningState();
    const db = await loadDb();
    const action = pathname === "/api/schedules" ? "import" : body.action;
    let rows = [];
    if (action === "import") {
      const normalized = normalizeSchedules(body.schedules);
      if (!normalized.ok) { json(res, 400, normalized); return true; }
      rows = normalized.schedules;
      if (body.preview === true) {
        json(res, 200, { impact: importImpact(db.schedules, rows), revision: state.revision });
        return true;
      }
    }
    const update = planUpdate(db, state, body, rows, action);
    const saved = await commitPlanning(update, { createdBy: admin.userId });
    const persisted = await loadDb();
    json(res, 200, { ok: true, revision: saved.revision, calendar: calendarContext(saved.calendar),
      schedules: persisted.schedules, count: persisted.schedules.length, importedCount: rows.length,
      impact: update.impact, snapshotId: update.id, batchId: saved.batchId });
  } catch (error) {
    if (!error.status && !/日期|星期一|学期|操作不合法/.test(error.message)) throw error;
    json(res, error.status || 400, { ok: false, reason: error.message });
  }
  return true;
}

module.exports = { handlePlanningApi };
