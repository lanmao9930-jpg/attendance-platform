const path = require("node:path");
const XLSX = require("xlsx");
const { centers, positions, shifts, weekdays, weeks } = require("./constants");

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ISSUES = 60;
const supportedExtensions = new Set([".xlsx", ".xls", ".csv"]);

const headerAliases = {
  center: ["中心", "所在中心", "所属中心", "部门", "所属部门"],
  week: ["周次", "周数", "值班周次", "第几周"],
  weekday: ["星期", "周几", "值班星期", "值班日"],
  shift: ["节次", "时间段", "值班时间", "值班时段", "时段", "班次"],
  name: ["值班人员", "姓名", "人员名单", "值班同学", "成员姓名", "人员"],
  position: ["职位", "职务", "岗位", "身份"],
  phone: ["联系电话", "手机号", "手机号码", "电话", "联系方式"]
};

const centerAliases = new Map([
  ["主席团", "主席团"],
  ["精英团", "精英团"],
  ["行政事务", "行政事务中心"],
  ["行政中心", "行政事务中心"],
  ["大数据", "大数据中心"],
  ["市场拓展", "市场拓展中心"],
  ["市场中心", "市场拓展中心"],
  ["视频运营", "视频运营中心"],
  ["视频中心", "视频运营中心"],
  ["宣讲招聘", "宣讲招聘中心"],
  ["宣招中心", "宣讲招聘中心"],
  ["培训", "培训中心"],
  ["职研", "职研中心"],
  ["职业研究", "职研中心"],
  ["青创", "青创中心"],
  ["青年创新创业", "青创中心"],
  ["新媒体", "新媒体中心"]
]);

function parseScheduleWorkbook({ fileName, fileDataUrl }) {
  const safeName = path.basename(String(fileName || "").trim());
  const extension = path.extname(safeName).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error("仅支持 .xlsx、.xls 或 .csv 文件");
  }
  const buffer = decodeFileData(fileDataUrl);
  if (buffer.length > MAX_FILE_BYTES) throw new Error("文件不能超过 4 MB");

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellText: true });
  } catch {
    throw new Error("无法读取该表格，请确认文件没有损坏或加密");
  }

  const schedules = [];
  const issues = [];
  const sheetSummaries = [];
  let issueCount = 0;

  const addIssue = (issue) => {
    issueCount += 1;
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false
    });
    const parsed = parseSheetRows(rows, sheetName, addIssue);
    schedules.push(...parsed.schedules);
    sheetSummaries.push(parsed.summary);
  });

  const deduplicated = deduplicateSchedules(schedules);
  const peopleCount = new Set(deduplicated.map((row) => `${row.center}|${row.name}`)).size;
  return {
    fileName: safeName,
    schedules: deduplicated,
    peopleCount,
    sheetSummaries,
    issues,
    issueCount,
    ignoredIssueCount: Math.max(0, issueCount - issues.length)
  };
}

function parseSheetRows(sourceRows, sheetName, addIssue) {
  const rows = sourceRows.map((row) => Array.from(row || [], cleanCell));
  const header = findHeader(rows);
  if (!header) {
    return {
      schedules: [],
      summary: {
        sheetName,
        headerRow: null,
        importedCount: 0,
        issueCount: 0,
        status: rows.some((row) => row.some(Boolean)) ? "未找到固定排班表头" : "空工作表"
      }
    };
  }

  const contextText = [sheetName, ...rows.slice(0, header.rowIndex + 1).flat()].filter(Boolean).join(" ");
  const defaultCenters = detectCenters(contextText);
  const defaultCenter = defaultCenters.length === 1 ? defaultCenters[0] : "";
  const schedules = [];
  const carried = { center: "", week: "", weekday: "", shift: "" };
  let localIssueCount = 0;

  const report = (rowNumber, reason, row) => {
    localIssueCount += 1;
    addIssue({
      sheetName,
      rowNumber,
      reason,
      preview: row.filter(Boolean).slice(0, 5).join(" | ").slice(0, 140)
    });
  };

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex];
    if (!cells.some(Boolean) || looksLikeHeader(cells)) continue;
    const raw = Object.fromEntries(Object.keys(headerAliases).map((field) => [field, valueAt(cells, header.map[field])]));
    const hasNameLikeValue = Boolean(raw.name);
    const hasScheduleLikeValue = Boolean(raw.week || raw.weekday || raw.shift);
    if (!hasNameLikeValue && !hasScheduleLikeValue) continue;

    for (const field of Object.keys(carried)) {
      if (raw[field]) carried[field] = raw[field];
      else raw[field] = carried[field];
    }

    const combinedTime = [raw.week, raw.weekday, raw.shift].filter(Boolean).join(" ");
    const centerResult = normalizeCenter(raw.center || defaultCenter);
    const week = normalizeWeek(raw.week) || normalizeWeek(combinedTime, true);
    const weekday = normalizeWeekday(raw.weekday) || normalizeWeekday(combinedTime);
    const normalizedShifts = normalizeShifts(raw.shift || combinedTime);
    const names = splitNames(raw.name);

    const missing = [];
    if (!centerResult.value) missing.push(centerResult.ambiguous ? "中心名称包含多个中心" : "缺少或无法识别中心");
    if (!week) missing.push("缺少或无法识别周次");
    if (!weekday) missing.push("缺少或无法识别星期");
    if (!normalizedShifts.length) missing.push("缺少或无法识别节次");
    if (!names.length) missing.push("缺少值班人员姓名");
    if (missing.length) {
      report(rowIndex + 1, missing.join("、"), cells);
      continue;
    }

    const position = normalizePosition(raw.position);
    const phone = normalizePhone(raw.phone);
    names.forEach((name) => normalizedShifts.forEach((shift) => schedules.push({
      center: centerResult.value,
      week,
      weekday,
      shift,
      name,
      position,
      phone,
      sourceSheet: sheetName,
      sourceRow: rowIndex + 1
    })));
  }

  return {
    schedules,
    summary: {
      sheetName,
      headerRow: header.rowIndex + 1,
      importedCount: schedules.length,
      issueCount: localIssueCount,
      status: schedules.length ? `识别 ${schedules.length} 条固定排班` : "找到表头，但没有完整固定排班"
    }
  };
}

function findHeader(rows) {
  let best = null;
  const limit = Math.min(rows.length, 50);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const map = {};
    rows[rowIndex].forEach((cell, columnIndex) => {
      const field = headerField(cell);
      if (!field) return;
      map[field] ||= [];
      map[field].push(columnIndex);
    });
    const fields = Object.keys(map);
    const hasName = fields.includes("name");
    const scheduleFields = ["week", "weekday", "shift"].filter((field) => fields.includes(field)).length;
    const score = fields.length + scheduleFields * 2 + (hasName ? 3 : 0);
    if (hasName && scheduleFields >= 1 && (!best || score > best.score)) best = { rowIndex, map, score };
  }
  return best;
}

function looksLikeHeader(cells) {
  return cells.filter((cell) => headerField(cell)).length >= 3;
}

function headerField(value) {
  const label = normalizeLabel(value);
  if (!label) return "";
  for (const [field, aliases] of Object.entries(headerAliases)) {
    if (aliases.some((alias) => label === normalizeLabel(alias))) return field;
  }
  for (const [field, aliases] of Object.entries(headerAliases)) {
    if (aliases.some((alias) => {
      const normalized = normalizeLabel(alias);
      return normalized.length >= 3 && label.includes(normalized);
    })) return field;
  }
  if (/姓名.*填|填.*姓名/.test(label)) return "name";
  return "";
}

function normalizeLabel(value) {
  return cleanCell(value).replace(/[\s　:：()（）【】\[\]_-]/g, "");
}

function cleanCell(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
  }
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function valueAt(cells, index) {
  const indexes = Array.isArray(index) ? index : [index];
  for (const columnIndex of indexes) {
    if (!Number.isInteger(columnIndex)) continue;
    const value = cleanCell(cells[columnIndex]);
    if (value) return value;
  }
  return "";
}

function normalizeCenter(value) {
  const found = detectCenters(value);
  if (found.length === 1) return { value: found[0], ambiguous: false };
  return { value: "", ambiguous: found.length > 1 };
}

function detectCenters(value) {
  const text = normalizeLabel(value);
  if (!text) return [];
  const found = new Set();
  centers.forEach((center) => {
    if (text.includes(normalizeLabel(center))) found.add(center);
  });
  for (const [alias, center] of centerAliases) {
    if (text.includes(normalizeLabel(alias))) found.add(center);
  }
  return [...found];
}

function normalizeWeek(value, requireWeekMarker = false) {
  const text = cleanCell(value);
  if (!text) return 0;
  const marked = text.match(/第?\s*(\d{1,2})\s*周/);
  const plain = !requireWeekMarker && text.match(/^\s*(\d{1,2})\s*$/);
  const week = Number((marked || plain || [])[1] || 0);
  return weeks.includes(week) ? week : 0;
}

function normalizeWeekday(value) {
  const text = normalizeLabel(value);
  if (!text) return "";
  const direct = weekdays.find((weekday) => text.includes(normalizeLabel(weekday)));
  if (direct) return direct;
  const match = text.match(/(?:周|星期)([一二三四五六日天1-7])/);
  if (!match) return "";
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const day = Number(map[match[1]] || match[1]);
  return weekdays[day - 1] || "";
}

function normalizeShifts(value) {
  const text = normalizeLabel(value).replace(/[至到~—–]/g, "-");
  if (!text) return [];
  const found = new Set();
  shifts.forEach((shift) => {
    if (text.includes(normalizeLabel(shift.label))) found.add(shift.label);
  });
  const patterns = [
    { regex: /(?:^|[^\d])(?:1\s*[-、,，/]?\s*2|一\s*[-、,，/]?\s*二)(?:节|课|$)/, label: shifts[0].label },
    { regex: /(?:^|[^\d])(?:3\s*[-、,，/]?\s*4|三\s*[-、,，/]?\s*四)(?:节|课|$)/, label: shifts[1].label },
    { regex: /(?:^|[^\d])(?:5\s*[-、,，/]?\s*6|五\s*[-、,，/]?\s*六)(?:节|课|$)/, label: shifts[2].label },
    { regex: /(?:^|[^\d])(?:7\s*[-、,，/]?\s*8|七\s*[-、,，/]?\s*八)(?:节|课|$)/, label: shifts[3].label }
  ];
  patterns.forEach(({ regex, label }) => {
    if (regex.test(text)) found.add(label);
  });
  if (/08[:：]?00|8[:：]?00|09[:：]?40/.test(text)) found.add(shifts[0].label);
  if (/10[:：]?10|11[:：]?50/.test(text)) found.add(shifts[1].label);
  if (/14[:：]?30|16[:：]?10/.test(text)) found.add(shifts[2].label);
  if (/16[:：]?20|18[:：]?00/.test(text)) found.add(shifts[3].label);
  return [...found];
}

function splitNames(value) {
  const text = cleanCell(value);
  if (!text || headerField(text)) return [];
  let names = text.split(/[、,，;；/\\\n]+/).map((item) => item.trim()).filter(Boolean);
  if (names.length === 1) {
    const spaced = text.split(/\s+/).filter(Boolean);
    if (spaced.length > 1 && spaced.every((item) => /^[\u3400-\u9fff·]{2,6}$/.test(item))) names = spaced;
  }
  return names.filter((name) => name.length <= 30);
}

function normalizePosition(value) {
  const text = cleanCell(value);
  return positions.find((position) => text.includes(position)) || text.slice(0, 30);
}

function normalizePhone(value) {
  return cleanCell(value).replace(/\.0$/, "").replace(/\s+/g, "").slice(0, 30);
}

function deduplicateSchedules(schedules) {
  const seen = new Set();
  return schedules.filter((row) => {
    const key = [row.center, row.week, row.weekday, row.shift, row.name].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeFileData(value) {
  const match = /^data:[^;]*;base64,([A-Za-z0-9+/=\s]+)$/s.exec(String(value || ""));
  if (!match) throw new Error("文件内容格式不正确，请重新选择文件");
  return Buffer.from(match[1].replace(/\s/g, ""), "base64");
}

module.exports = {
  MAX_FILE_BYTES,
  parseScheduleWorkbook
};
