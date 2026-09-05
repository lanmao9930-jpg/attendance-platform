const assert = require("node:assert/strict");
const { createPlanningStore } = require("../lib/cloud-planning");
const { planUpdate, initialPlanning } = require("../lib/planning");
const documents = new Map();
let rejectWrite = false;
const db = {
  collection() { return { doc(id) { return {
    async get() { return { data: documents.has(id) ? [structuredClone(documents.get(id))] : [] }; },
    async set(value) { if (rejectWrite && id.endsWith('-meta')) throw new Error('network interruption'); documents.set(id, structuredClone(value)); }
  }; } }; },
  async runTransaction(action) { return action(db); }
};
const store = createPlanningStore({ cloudBase: () => ({ db }), useCloudBaseStore: () => true });
(async () => {
  const state = initialPlanning();
  const row = { id: 'a', center: '行政事务中心', name: '测试', week: 1, weekday: '星期一', shift: '一二节' };
  const update = planUpdate({ schedules: [], reviews: [] }, state, { expectedRevision: 0 }, [row]);
  const saved = await store.commitPlanning(update);
  assert.equal(saved.revision, 1);
  assert.equal((await store.readSnapshot(saved.scheduleSnapshotId)).schedules.length, 1);
  assert.equal((await store.loadImportSnapshots(update.id)).schedules.length, 0);
  await assert.rejects(store.commitPlanning(update), /刷新/);
  const next = planUpdate({ schedules: [row], reviews: [] }, saved, { expectedRevision: 1 }, [{ ...row, shift: '三四节' }]);
  rejectWrite = true;
  await assert.rejects(store.commitPlanning(next), /network interruption/);
  assert.equal((await store.loadPlanningState()).scheduleSnapshotId, saved.scheduleSnapshotId);
  assert.equal((await store.loadImportSnapshots()).length, 1);
  console.log('CloudBase snapshot pointer, stale revision and interrupted-upload tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
