import { redactText, redactValue } from "./log-redaction.js";

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function line(label, value) {
  const formatted = formatValue(value);
  return formatted ? `${label}: ${formatted}` : null;
}

function compactCount(label, value) {
  return `${label}: ${Number(value || 0)}`;
}

function formatSummary(label, summary) {
  if (!summary) return [];
  const parts = Object.entries(summary)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${formatValue(redactValue(key, value))}`);
  return parts.length ? [`${label}: ${parts.join(", ")}`] : [];
}

function formatDeletedItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return [
    "Deleted media:",
    ...items.map((item) => {
      const title = item.Title || item.title || "Unknown title";
      const type = item.Type || item.type || "Media";
      const year = item.Year || item.year;
      const method = item.DeletionMethod || item.Method || item.method;
      return `  - ${title}${year ? ` (${year})` : ""} - ${type}${method ? ` via ${method}` : ""}`;
    }),
  ];
}

function formatFailedItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return [
    "Failed media:",
    ...items.map((item) => {
      const title = item.Title || item.title || "Unknown title";
      const type = item.Type || item.type || "Media";
      const reason =
        item.DeleteError || item.Error || item.error || item.Message || item.message;
      return `  - ${title} - ${type}${reason ? ` - ${formatValue(reason)}` : ""}`;
    }),
  ];
}

function runLabel(entry) {
  if (entry.type === "deletion") {
    return entry.source === "scheduler" ? "Scheduled deletion check" : "Deletion check";
  }
  if (entry.source === "scheduler" && ["scan", "preview"].includes(entry.type)) {
    return "Scheduled scan";
  }
  if (entry.type === "preview") return "Preview scan";
  if (entry.type === "scan") return "Scan";
  return entry.type || "Run";
}

function runHeading(entry) {
  const timestamp = entry.completedAt || entry.startedAt || "unknown time";
  const source = entry.source || "unknown";
  const status = entry.status || "unknown";
  return `[${timestamp}] ${runLabel(entry)} (${source}) - ${status}`;
}

function modeValue(entry) {
  if (entry.type === "deletion") {
    if (entry.dryRun === true) return "Preview only mode";
    if (entry.dryRun === false) return "Live mode";
  }
  if (entry.cleanup && typeof entry.cleanup.dryRun === "boolean") {
    return entry.cleanup.dryRun ? "Preview only mode" : "Live mode";
  }
  if (entry.dryRun === true || entry.readOnly === true) return "Preview only mode";
  if (entry.dryRun === false) return "Live mode";
  return "";
}

function formatRunEntry(entry) {
  const lines = [
    runHeading(entry),
    line("Started", entry.startedAt),
    line("Completed", entry.completedAt),
    line("Mode", modeValue(entry)),
    line("Message", entry.message),
  ].filter(Boolean);

  if (entry.type === "deletion") {
    lines.push(
      compactCount("Expired total", entry.expiredTotal),
      compactCount("Expired movies", entry.expiredMovies),
      compactCount("Expired series", entry.expiredSeries),
      compactCount("Deleted total", entry.deletedTotal),
      compactCount("Movies deleted", entry.deletedMovies),
      compactCount("Series deleted", entry.deletedSeries),
      compactCount("Failed total", entry.failedTotal),
      ...formatDeletedItems(entry.deletedItems),
      ...formatFailedItems(entry.failedItems),
    );
  } else {
    lines.push(
      compactCount("Scanned", entry.scanned),
      compactCount("Candidates", entry.candidates),
      compactCount("Candidate movies", entry.candidateMovies),
      compactCount("Candidate series", entry.candidateSeries),
      compactCount("Queued", entry.queued),
      compactCount("Queued movies", entry.queuedMovies),
      compactCount("Queued series", entry.queuedSeries),
    );
  }

  if (Array.isArray(entry.warnings) && entry.warnings.length > 0) {
    lines.push("Warnings:", ...entry.warnings.map((warning) => `  - ${formatValue(warning)}`));
  }

  lines.push(
    ...formatSummary("Media server library sync", entry.librarySync),
    ...formatSummary("Telegram notifications", entry.notifications),
    ...formatSummary("Telegram deletion report", entry.telegram),
    ...formatSummary("Telegram failure report", entry.failureTelegram),
    ...formatSummary("Deletion check", entry.cleanup),
  );

  if (entry.skipped && Object.keys(entry.skipped).length > 0) {
    lines.push(`Skipped: ${formatValue(entry.skipped)}`);
  }

  return `${lines.join("\n")}\n`;
}

export function formatRunLogExport(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return "No run log entries found.\n";
  return `${list.map(formatRunEntry).join("\n")}\n`;
}

export function formatAppLogExport(content = "") {
  const lines = String(content).split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return "No app log entries found.\n";

  return `${lines.map((rawLine) => {
    try {
      const entry = JSON.parse(rawLine);
      const {
        timestamp = "unknown time",
        level = "info",
        message = "",
        ...meta
      } = entry;
      const safeMeta = redactValue("meta", meta);
      const metaText = Object.entries(safeMeta)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(", ");
      return `[${timestamp}] ${String(level).toUpperCase()} ${formatValue(message)}${metaText ? ` | ${metaText}` : ""}`;
    } catch {
      return `[unparsed] ${redactText(rawLine)}`;
    }
  }).join("\n")}\n`;
}

export function logExportFileName(type, now = new Date()) {
  const safeType = type === "app" ? "app" : "run";
  return `Scrubarr-${safeType}-log-${now.toISOString().slice(0, 10)}.log`;
}

export function logsZipFileName(now = new Date()) {
  return `Scrubarr-logs-${now.toISOString().slice(0, 10)}.zip`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateParts(now) {
  const year = Math.max(now.getUTCFullYear(), 1980);
  return {
    time:
      (now.getUTCHours() << 11) |
      (now.getUTCMinutes() << 5) |
      Math.floor(now.getUTCSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((now.getUTCMonth() + 1) << 5) |
      now.getUTCDate(),
  };
}

function safeZipName(name) {
  const normalized = String(name || "log.log")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  return normalized || "log.log";
}

function localFileHeader({ nameBuffer, contentBuffer, checksum, timestamp }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(timestamp.time, 10);
  header.writeUInt16LE(timestamp.date, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(contentBuffer.length, 18);
  header.writeUInt32LE(contentBuffer.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer]);
}

function centralDirectoryHeader({
  nameBuffer,
  contentBuffer,
  checksum,
  timestamp,
  localOffset,
}) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(timestamp.time, 12);
  header.writeUInt16LE(timestamp.date, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(contentBuffer.length, 20);
  header.writeUInt32LE(contentBuffer.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, nameBuffer]);
}

function endOfCentralDirectory({ entryCount, centralDirectorySize, centralDirectoryOffset }) {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

export function createLogsZip(files = [], now = new Date()) {
  const timestamp = zipDateParts(now);
  const entries = files.map((file) => {
    const nameBuffer = Buffer.from(safeZipName(file.name), "utf8");
    const contentBuffer = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(String(file.content || ""), "utf8");
    return {
      nameBuffer,
      contentBuffer,
      checksum: crc32(contentBuffer),
      timestamp,
    };
  });

  const localParts = [];
  let offset = 0;
  for (const entry of entries) {
    entry.localOffset = offset;
    const header = localFileHeader(entry);
    localParts.push(header, entry.contentBuffer);
    offset += header.length + entry.contentBuffer.length;
  }

  const centralDirectoryOffset = offset;
  const centralParts = entries.map((entry) => centralDirectoryHeader(entry));
  const centralDirectorySize = centralParts.reduce(
    (total, part) => total + part.length,
    0,
  );

  return Buffer.concat([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory({
      entryCount: entries.length,
      centralDirectorySize,
      centralDirectoryOffset,
    }),
  ]);
}
