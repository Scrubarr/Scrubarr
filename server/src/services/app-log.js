import fs from "node:fs/promises";
import path from "node:path";
import {
  redactAppLogEntry,
  redactAppLogLine,
  safeMessage,
} from "./log-redaction.js";

const MAX_LINES = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class AppLogService {
  constructor(filePath) {
    this.filePath = filePath;
    this.debugEnabledProvider = async () => false;
    this.retentionDaysProvider = async () => null;
  }

  setDebugEnabledProvider(provider) {
    this.debugEnabledProvider = provider;
  }

  setRetentionDaysProvider(provider) {
    this.retentionDaysProvider = provider;
  }

  async retentionDays() {
    const value = Number(await this.retentionDaysProvider());
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  async applyRetention() {
    const days = await this.retentionDays();
    if (!days) return;

    const cutoff = Date.now() - days * DAY_MS;
    let content;
    try {
      content = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    const lines = content.split(/\r?\n/).filter(Boolean);
    const retained = lines.filter((line) => {
      try {
        const parsed = JSON.parse(line);
        const timestamp = Date.parse(parsed.timestamp);
        return !Number.isFinite(timestamp) || timestamp >= cutoff;
      } catch {
        return true;
      }
    });

    if (retained.length !== lines.length) {
      await fs.writeFile(this.filePath, `${retained.join("\n")}\n`, "utf8");
    }
  }

  async write(level, message, meta = {}) {
    const entry = redactAppLogEntry({
      timestamp: new Date().toISOString(),
      level,
      message: safeMessage(message),
      ...(meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}),
    });
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    await this.applyRetention();
    return entry;
  }

  info(message, meta) {
    return this.write("info", message, meta);
  }

  warn(message, meta) {
    return this.write("warn", message, meta);
  }

  error(message, meta) {
    return this.write("error", message, meta);
  }

  async debug(message, meta) {
    if (!(await this.debugEnabledProvider())) return null;
    return this.write("debug", message, meta);
  }

  async file() {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      return {
        fileName: path.basename(this.filePath),
        content: `${lines.slice(-MAX_LINES).map(redactAppLogLine).join("\n")}\n`,
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { fileName: path.basename(this.filePath), content: "" };
      }
      throw error;
    }
  }
}
