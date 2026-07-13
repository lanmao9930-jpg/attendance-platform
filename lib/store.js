const fs = require("node:fs/promises");
const path = require("node:path");
const { seedSchedules } = require("./constants");

const DATA_DIR = path.join(__dirname, "..", "data");
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
      version: 1,
      schedules: seedSchedules,
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
    return db;
  } catch {
    const db = {
      version: 1,
      createdAt: new Date().toISOString(),
      schedules: seedSchedules,
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

async function loadBlobCheckins() {
  const { get, list } = await import("@vercel/blob");
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix: "checkins/", cursor, limit: 1000, ...blobOptions() });
    cursor = page.cursor;
    for (const blob of page.blobs) {
      const item = await get(blob.pathname, { access: "private", useCache: false, ...blobOptions() });
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
      photoStored: true
    };
  }

  await fs.mkdir(PHOTO_DIR, { recursive: true });
  const localName = `${recordId}-${safeName}`;
  await fs.writeFile(path.join(PHOTO_DIR, localName), parsed.buffer);
  return {
    photoName: safeName,
    photoPath: `photos/${localName}`,
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
  const reader = stream.getReader();
  const chunks = [];
  let done = false;
  while (!done) {
    const next = await reader.read();
    done = next.done;
    if (next.value) chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function storageMode() {
  return useBlobStore() ? "vercel-blob" : "local-json";
}

module.exports = {
  addCheckin,
  loadDb,
  storageMode
};
