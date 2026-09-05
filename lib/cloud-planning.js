const { gzipSync, gunzipSync } = require("node:zlib");
const { initialPlanning, planningError } = require("./planning");

function createPlanningStore({ cloudBase, useCloudBaseStore, loadLocalDb, saveLocalDb }) {
  const collection = "attendance_schedule_history";
  const stateId = "_planning-state";
  const first = result => Array.isArray(result.data) ? result.data[0] : result.data;
  async function loadPlanningState() {
    if (!useCloudBaseStore()) return (await loadLocalDb()).planning || initialPlanning();
    const row = first(await cloudBase().db.collection(collection).doc(stateId).get());
    if (!row) return initialPlanning();
    const { _id, ...state } = row;
    return state;
  }
  async function writeSnapshot(id, value) {
    const encoded = gzipSync(JSON.stringify(value)).toString("base64");
    const chunks = Math.ceil(encoded.length / 120000);
    const db = cloudBase().db;
    for (let i = 0; i < chunks; i++) {
      await db.collection(collection).doc(`planning-${id}-${i}`).set({ type: "planning-blob", content: encoded.slice(i * 120000, (i + 1) * 120000) });
    }
    await db.collection(collection).doc(`planning-${id}-meta`).set({ type: "planning-blob-meta", chunks });
  }
  async function readSnapshot(id) {
    const db = cloudBase().db;
    const meta = first(await db.collection(collection).doc(`planning-${id}-meta`).get());
    if (!meta) throw new Error("排班快照不完整，请联系管理员");
    const chunks = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => db.collection(collection).doc(`planning-${id}-${i}`).get()));
    const encoded = chunks.map(result => {
      const row = first(result);
      if (!row?.content) throw new Error("排班快照分块缺失");
      return row.content;
    }).join("");
    return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
  }
  async function commitPlanning(update) {
    const current = await loadPlanningState();
    if (current.revision !== update.expectedRevision) throw planningError("排班已被更新，请刷新后重试", 409);
    const metadata = { id: update.id, action: update.action, createdAt: update.createdAt,
      name: update.calendar.name, sourceName: update.sourceName, impact: update.impact, count: update.before.schedules.length };
    const next = { ...update.state, imports: [metadata, ...(current.imports || [])], batchArchives: current.batchArchives || [] };
    if (next.batchId) next.batchCalendars[next.batchId] = next.calendar;
    if (update.action === "new-semester" && update.before.schedules.length) {
      const rows = update.before.schedules;
      next.batchArchives = [...next.batchArchives, { id: rows[0].batchId || current.batchId || update.id,
        name: update.before.calendar.name, isActive: false, createdAt: rows[0].batchCreatedAt || "",
        archivedAt: update.createdAt, count: rows.length,
        peopleCount: new Set(rows.map(row => `${row.center}|${row.name}`)).size,
        centerCount: new Set(rows.map(row => row.center)).size, snapshotId: update.id }];
    }
    if (!useCloudBaseStore()) {
      const db = await loadLocalDb();
      if ((db.planning?.revision || 0) !== update.expectedRevision) throw planningError("排班已被更新，请刷新后重试", 409);
      db.importSnapshots ||= {};
      db.importSnapshots[update.id] = update.before;
      db.planning = next;
      db.schedules = update.schedules;
      await saveLocalDb(db);
      return next;
    }
    // 先写不可变快照，再事务切换指针；中途失败不会覆盖当前排班。
    await writeSnapshot(update.id, update.before);
    if (update.action !== "calendar") {
      next.scheduleSnapshotId = `${update.id}-current`;
      await writeSnapshot(next.scheduleSnapshotId, { schedules: update.schedules });
    }
    const db = cloudBase().db;
    await db.runTransaction(async transaction => {
      const doc = transaction.collection(collection).doc(stateId);
      const stored = first(await doc.get());
      if ((stored?.revision || 0) !== update.expectedRevision) throw planningError("排班已被更新，请刷新后重试", 409);
      await doc.set(next);
    });
    return next;
  }
  async function loadImportSnapshots(id) {
    const state = await loadPlanningState();
    if (!id) return state.imports || [];
    if (!(state.imports || []).some(item => item.id === id)) return null;
    return useCloudBaseStore() ? readSnapshot(id) : (await loadLocalDb()).importSnapshots?.[id] || null;
  }
  return { loadPlanningState, commitPlanning, loadImportSnapshots, readSnapshot };
}
module.exports = { createPlanningStore };
