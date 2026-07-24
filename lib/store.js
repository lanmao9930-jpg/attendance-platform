const fs = require("node:fs/promises");
const path = require("node:path");
const { seedSchedules } = require("./constants");

const DATA_DIR = process.env.ATTENDANCE_DATA_DIR
  ? path.resolve(process.env.ATTENDANCE_DATA_DIR)
  : path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "attendance-db.json");
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const CLOUDBASE_COLLECTIONS = {
  schedules: "attendance_schedules",
  scheduleHistory: "attendance_schedule_history",
  reviews: "attendance_reviews",
  checkins: "attendance_checkins"
};

let cloudBaseApp;

function useCloudBaseStore() {
  return Boolean(process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV);
}

function useBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function blobOptions(extra = {}) {
  return process.env.BLOB_READ_WRITE_TOKEN
    ? { token: process.env.BLOB_READ_WRITE_TOKEN, ...extra }
    : extra;
}

async function loadDb() {
  if (useCloudBaseStore()) {
    return {
      version: 3,
      schedules: await loadCloudBaseCollection(CLOUDBASE_COLLECTIONS.schedules),
      reviews: await loadCloudBaseCollection(CLOUDBASE_COLLECTIONS.reviews),
      checkins: await loadCloudBaseCollection(CLOUDBASE_COLLECTIONS.checkins, "createdAt", "desc")
    };
  }
  if (useBlobStore()) {
    return {
      version: 2,
      schedules: await loadBlobJson("meta/schedules.json", seedSchedules),
      scheduleHistory: await loadBlobJson("meta/schedule-history.json", []),
      reviews: await loadBlobJson("meta/reviews.json", []),
      checkins: await loadBlobCheckins()
    };
  }
  return loadLocalDb();
}

async function loadLocalDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const db = JSON.parse(await fs.readFile(DB_PATH, "utf8"));
    db.checkins ||= [];
    db.schedules ||= seedSchedules;
    db.scheduleHistory ||= [];
    db.reviews ||= [];
    return db;
  } catch {
    const db = {
      version: 2,
      createdAt: new Date().toISOString(),
      schedules: seedSchedules,
      scheduleHistory: [],
      reviews: [],
      checkins: []
    };
    await saveLocalDb(db);
    return db;
  }
}

async function saveLocalDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

async function addCheckin(record, photoDataUrl) {
  const photo = await savePhoto(record.id, record.photoName, photoDataUrl);
  const storedRecord = {
    ...record,
    ...photo,
    photoDataUrl: undefined
  };

  if (useCloudBaseStore()) {
    const { db } = cloudBase();
    await db.collection(CLOUDBASE_COLLECTIONS.checkins).doc(record.id).set(storedRecord);
    return storedRecord;
  }

  if (useBlobStore()) {
    const { put } = await import("@vercel/blob");
    await put(`checkins/${record.id}.json`, JSON.stringify(storedRecord), {
      access: "private",
      allowOverwrite: false,
      contentType: "application/json; charset=utf-8",
      ...blobOptions()
    });
    return storedRecord;
  }

  const db = await loadLocalDb();
  db.checkins.unshift(storedRecord);
  await saveLocalDb(db);
  return storedRecord;
}

async function saveSchedules(schedules) {
  if (useCloudBaseStore()) {
    await replaceCloudBaseCollection(CLOUDBASE_COLLECTIONS.schedules, schedules);
    return schedules;
  }
  if (useBlobStore()) {
    await saveBlobJson("meta/schedules.json", schedules);
    return schedules;
  }
  const db = await loadLocalDb();
  db.schedules = schedules;
  await saveLocalDb(db);
  return schedules;
}

async function loadScheduleHistory() {
  if (useCloudBaseStore()) {
    const records = await loadCloudBaseCollection(CLOUDBASE_COLLECTIONS.scheduleHistory, "", "asc", { type: "batch" });
    return records.map(historySummary);
  }
  if (useBlobStore()) {
    const history = await loadBlobJson("meta/schedule-history.json", []);
    return history.map(historySummary);
  }
  const db = await loadLocalDb();
  return (db.scheduleHistory || []).map(historySummary);
}

async function loadScheduleHistoryBatch(batchId) {
  const id = String(batchId || "").trim();
  if (!id) return [];
  if (useCloudBaseStore()) {
    const documents = await loadCloudBaseCollection(CLOUDBASE_COLLECTIONS.scheduleHistory, "", "asc", { batchId: id });
    return documents
      .filter((document) => document.type === "chunk")
      .sort((left, right) => Number(left.chunkIndex) - Number(right.chunkIndex))
      .flatMap((document) => Array.isArray(document.rows) ? document.rows : []);
  }
  const history = useBlobStore()
    ? await loadBlobJson("meta/schedule-history.json", [])
    : (await loadLocalDb()).scheduleHistory || [];
  return history.find((batch) => batch.id === id)?.schedules || [];
}

async function saveScheduleHistoryBatch(batch, schedules) {
  const rows = Array.isArray(schedules) ? schedules : [];
  if (!batch?.id || !rows.length) return null;
  const summary = {
    id: String(batch.id),
    name: String(batch.name || "历史固定排班"),
    createdAt: String(batch.createdAt || ""),
    archivedAt: String(batch.archivedAt || new Date().toISOString()),
    isActive: false,
    count: rows.length,
    centerCount: new Set(rows.map((schedule) => schedule.center)).size,
    peopleCount: new Set(rows.map((schedule) => `${schedule.center}|${schedule.name}`)).size
  };

  if (useCloudBaseStore()) {
    const { db } = cloudBase();
    const metadataId = `${summary.id}-meta`;
    await db.collection(CLOUDBASE_COLLECTIONS.scheduleHistory).doc(metadataId).set({
      ...summary,
      id: metadataId,
      batchId: summary.id,
      type: "batch"
    });
    const chunks = [];
    const chunkSize = 200;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunkIndex = Math.floor(index / chunkSize);
      chunks.push({
        id: `${summary.id}-chunk-${String(chunkIndex).padStart(4, "0")}`,
        batchId: summary.id,
        type: "chunk",
        chunkIndex,
        rows: rows.slice(index, index + chunkSize)
      });
    }
    await runInBatches(chunks, (chunk) => {
      const { id, ...document } = chunk;
      return db.collection(CLOUDBASE_COLLECTIONS.scheduleHistory).doc(id).set({ id, ...document });
    });
    return summary;
  }

  if (useBlobStore()) {
    const history = await loadBlobJson("meta/schedule-history.json", []);
    const next = history.filter((item) => item.id !== summary.id);
    next.push({ ...summary, schedules: rows });
    await saveBlobJson("meta/schedule-history.json", next);
    return summary;
  }

  const db = await loadLocalDb();
  db.scheduleHistory = (db.scheduleHistory || []).filter((item) => item.id !== summary.id);
  db.scheduleHistory.push({ ...summary, schedules: rows });
  await saveLocalDb(db);
  return summary;
}

function historySummary(batch) {
  return {
    id: String(batch.batchId || batch.id || ""),
    name: String(batch.name || "历史固定排班"),
    createdAt: String(batch.createdAt || ""),
    archivedAt: String(batch.archivedAt || ""),
    isActive: false,
    count: Number(batch.count || batch.schedules?.length || 0),
    centerCount: Number(batch.centerCount || new Set((batch.schedules || []).map((schedule) => schedule.center)).size),
    peopleCount: Number(batch.peopleCount || new Set((batch.schedules || []).map((schedule) => `${schedule.center}|${schedule.name}`)).size)
  };
}

async function saveReview(review) {
  if (useCloudBaseStore()) {
    const { db } = cloudBase();
    await db.collection(CLOUDBASE_COLLECTIONS.reviews).doc(review.scheduleId).set(review);
    return review;
  }
  if (useBlobStore()) {
    const reviews = await loadBlobJson("meta/reviews.json", []);
    const index = reviews.findIndex((item) => item.scheduleId === review.scheduleId);
    if (index >= 0) reviews[index] = review;
    else reviews.push(review);
    await saveBlobJson("meta/reviews.json", reviews);
    return review;
  }
  const db = await loadLocalDb();
  db.reviews ||= [];
  const index = db.reviews.findIndex((item) => item.scheduleId === review.scheduleId);
  if (index >= 0) db.reviews[index] = review;
  else db.reviews.push(review);
  await saveLocalDb(db);
  return review;
}

async function loadBlobCheckins() {
  const { get, list } = await import("@vercel/blob");
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix: "checkins/", cursor, limit: 1000, ...blobOptions() });
    cursor = page.cursor;
    for (const blob of page.blobs) {
      const item = await get(blob.url, { access: "private", useCache: false, ...blobOptions() });
      if (!item || item.statusCode !== 200) continue;
      const text = await streamToText(item.stream);
      records.push(JSON.parse(text));
    }
  } while (cursor);
  return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function savePhoto(recordId, photoName, photoDataUrl) {
  if (!photoDataUrl) return {};
  const parsed = parseDataUrl(photoDataUrl);
  if (!parsed) return {};
  const safeName = safeFileName(photoName || "duty-photo.jpg");
  const pathname = `photos/${recordId}/${safeName}`;

  if (useCloudBaseStore()) {
    const { app } = cloudBase();
    const result = await app.uploadFile({ cloudPath: pathname, fileContent: parsed.buffer });
    return {
      photoName: safeName,
      photoPath: pathname,
      photoFileId: result.fileID,
      photoContentType: parsed.contentType,
      photoStored: true
    };
  }

  if (useBlobStore()) {
    const { put } = await import("@vercel/blob");
    const result = await put(pathname, parsed.buffer, {
      access: "private",
      allowOverwrite: false,
      contentType: parsed.contentType,
      ...blobOptions()
    });
    return {
      photoName: safeName,
      photoPath: result.pathname,
      photoContentType: parsed.contentType,
      photoStored: true
    };
  }

  await fs.mkdir(PHOTO_DIR, { recursive: true });
  const localName = `${recordId}-${safeName}`;
  await fs.writeFile(path.join(PHOTO_DIR, localName), parsed.buffer);
  return {
    photoName: safeName,
    photoPath: `photos/${localName}`,
    photoContentType: parsed.contentType,
    photoStored: true
  };
}

function parseDataUrl(value) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(value || ""));
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function safeFileName(value) {
  return String(value || "file")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function streamToText(stream) {
  return (await streamToBuffer(stream)).toString("utf8");
}

async function streamToBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let done = false;
  while (!done) {
    const next = await reader.read();
    done = next.done;
    if (next.value) chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks);
}

async function loadBlobJson(pathname, fallback) {
  const { get, list } = await import("@vercel/blob");
  const page = await list({ prefix: pathname, limit: 10, ...blobOptions() });
  const blob = page.blobs.find((item) => item.pathname === pathname);
  if (!blob) return fallback;
  const item = await get(blob.url, { access: "private", useCache: false, ...blobOptions() });
  if (!item || item.statusCode !== 200) return fallback;
  try {
    return JSON.parse(await streamToText(item.stream));
  } catch {
    return fallback;
  }
}

async function saveBlobJson(pathname, value) {
  const { put } = await import("@vercel/blob");
  await put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    ...blobOptions()
  });
}

async function loadPhoto(record) {
  if (!record?.photoPath && !record?.photoFileId) return null;
  if (useCloudBaseStore()) {
    if (!record.photoFileId) return null;
    const { app } = cloudBase();
    const result = await app.downloadFile({ fileID: record.photoFileId });
    return {
      buffer: result.fileContent,
      contentType: record.photoContentType || "image/jpeg"
    };
  }
  if (useBlobStore()) {
    const { get, list } = await import("@vercel/blob");
    const page = await list({ prefix: record.photoPath, limit: 10, ...blobOptions() });
    const blob = page.blobs.find((item) => item.pathname === record.photoPath);
    if (!blob) return null;
    const item = await get(blob.url, { access: "private", useCache: false, ...blobOptions() });
    if (!item || item.statusCode !== 200) return null;
    return {
      buffer: await streamToBuffer(item.stream),
      contentType: record.photoContentType || "image/jpeg"
    };
  }
  const localName = path.basename(record.photoPath);
  try {
    return {
      buffer: await fs.readFile(path.join(PHOTO_DIR, localName)),
      contentType: record.photoContentType || "image/jpeg"
    };
  } catch {
    return null;
  }
}

function storageMode() {
  if (useCloudBaseStore()) return "cloudbase";
  return useBlobStore() ? "vercel-blob" : "local-json";
}

function cloudBase() {
  if (cloudBaseApp) return cloudBaseApp;
  const tcb = require("@cloudbase/node-sdk");
  const env = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV || tcb.SYMBOL_DEFAULT_ENV;
  const app = tcb.init({ env });
  cloudBaseApp = { app, db: app.database() };
  return cloudBaseApp;
}

async function loadCloudBaseCollection(name, orderField, order = "asc", condition) {
  const { db } = cloudBase();
  const rows = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    let query = db.collection(name);
    if (condition) query = query.where(condition);
    if (orderField) query = query.orderBy(orderField, order);
    const page = await query.skip(offset).limit(pageSize).get();
    const items = Array.isArray(page.data) ? page.data : [];
    rows.push(...items.map(stripCloudBaseId));
    if (items.length < pageSize) break;
    offset += items.length;
  }
  return rows;
}

async function replaceCloudBaseCollection(name, records) {
  const { db } = cloudBase();
  const _ = db.command;
  await db.collection(name).where({ id: _.exists(true) }).remove();
  await runInBatches(records, (item) => {
    const documentId = String(item.id);
    const { _id, ...document } = item;
    return db.collection(name).doc(documentId).set(document);
  });
}

async function runInBatches(items, action, batchSize = 20) {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(action));
  }
}

function stripCloudBaseId(item) {
  if (!item || typeof item !== "object") return item;
  const { _id, ...rest } = item;
  return rest.id ? rest : { ...rest, id: _id };
}

module.exports = {
  addCheckin,
  loadDb,
  loadPhoto,
  loadScheduleHistory,
  loadScheduleHistoryBatch,
  saveReview,
  saveScheduleHistoryBatch,
  saveSchedules,
  storageMode
};
