const fs = require("node:fs/promises");
const path = require("node:path");
const { seedSchedules } = require("./constants");

const DATA_DIR = process.env.ATTENDANCE_DATA_DIR
  ? path.resolve(process.env.ATTENDANCE_DATA_DIR)
  : path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "attendance-db.json");
const PHOTO_DIR = path.join(DATA_DIR, "photos");

function useBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function blobOptions(extra = {}) {
  return process.env.BLOB_READ_WRITE_TOKEN
    ? { token: process.env.BLOB_READ_WRITE_TOKEN, ...extra }
    : extra;
}

async function loadDb() {
  if (useBlobStore()) {
    return {
      version: 2,
      schedules: await loadBlobJson("meta/schedules.json", seedSchedules),
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
    db.reviews ||= [];
    return db;
  } catch {
    const db = {
      version: 2,
      createdAt: new Date().toISOString(),
      schedules: seedSchedules,
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
  if (useBlobStore()) {
    await saveBlobJson("meta/schedules.json", schedules);
    return schedules;
  }
  const db = await loadLocalDb();
  db.schedules = schedules;
  await saveLocalDb(db);
  return schedules;
}

async function saveReview(review) {
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
  if (!record?.photoPath) return null;
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
  return useBlobStore() ? "vercel-blob" : "local-json";
}

module.exports = {
  addCheckin,
  loadDb,
  loadPhoto,
  saveReview,
  saveSchedules,
  storageMode
};
