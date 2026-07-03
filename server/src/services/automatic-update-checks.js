import { getCurrentVersion, checkForUpdates } from "./updates.js";
import { mergeSettings } from "../config/settings.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;

function settingEnabled(settings) {
  return settings.Updates?.AutoCheckEnabled !== false;
}

function resultSummary(result, source, checkedAt) {
  return {
    status: result.configured === false ? "not_configured" : "success",
    source,
    checkedAt,
    configured: result.configured !== false,
    currentVersion: result.currentVersion || getCurrentVersion(),
    latestVersion: result.latestVersion || null,
    updateAvailable: result.updateAvailable === true,
    releaseUrl: result.releaseUrl || null,
    notes: result.notes || null,
    message:
      result.message ||
      (result.updateAvailable
        ? `Version ${result.latestVersion} is available.`
        : "Scrubarr is up to date."),
  };
}

export class AutomaticUpdateCheckService {
  constructor({
    store,
    settingsStore,
    defaults,
    updateManifestUrl,
    appLog,
    check = checkForUpdates,
    intervalMs = DAY_MS,
  }) {
    this.store = store;
    this.settingsStore = settingsStore;
    this.defaults = defaults;
    this.updateManifestUrl = updateManifestUrl;
    this.appLog = appLog;
    this.check = check;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
    this.state = {
      lastCheck: null,
    };
  }

  async start() {
    const saved = await this.store.read();
    this.state = {
      lastCheck: saved.lastCheck || null,
    };
    await this.scheduleTimer();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async settings() {
    return mergeSettings(this.defaults, await this.settingsStore.read());
  }

  async status() {
    const settings = await this.settings();
    const enabled = settingEnabled(settings);
    const configured = Boolean(this.updateManifestUrl);
    return {
      enabled,
      configured,
      running: this.running,
      lastCheck: structuredClone(this.state.lastCheck),
      nextCheck:
        enabled && configured ? this.nextCheckDate().toISOString() : null,
    };
  }

  async refresh() {
    await this.scheduleTimer();
  }

  async runNow({ source = "manual" } = {}) {
    if (this.running) {
      return {
        status: "skipped",
        message: "Update check is already running.",
      };
    }

    this.running = true;
    try {
      const checkedAt = new Date().toISOString();
      const result = await this.check(this.updateManifestUrl);
      this.state.lastCheck = resultSummary(result, source, checkedAt);
      await this.persist();

      if (result.configured !== false) {
        await this.appLog.info("Update check completed", {
          source,
          currentVersion: this.state.lastCheck.currentVersion,
          latestVersion: this.state.lastCheck.latestVersion,
          updateAvailable: this.state.lastCheck.updateAvailable,
        });
      }
      return structuredClone(this.state.lastCheck);
    } catch (error) {
      const checkedAt = new Date().toISOString();
      this.state.lastCheck = {
        status: "failed",
        source,
        checkedAt,
        configured: Boolean(this.updateManifestUrl),
        currentVersion: getCurrentVersion(),
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        notes: null,
        message: error.message || "Update check failed.",
      };
      await this.persist();
      await this.appLog.warn("Update check failed", {
        source,
        message: this.state.lastCheck.message,
      });
      throw error;
    } finally {
      this.running = false;
      await this.scheduleTimer();
    }
  }

  nextCheckDate() {
    const checkedAt = this.state.lastCheck?.checkedAt
      ? new Date(this.state.lastCheck.checkedAt)
      : null;
    if (!checkedAt || Number.isNaN(checkedAt.getTime())) {
      return new Date(Date.now() + FIRST_CHECK_DELAY_MS);
    }
    return new Date(checkedAt.getTime() + this.intervalMs);
  }

  async persist() {
    await this.store.write(this.state);
  }

  async scheduleTimer() {
    this.stop();
    const settings = await this.settings();
    if (!settingEnabled(settings) || !this.updateManifestUrl) return;

    const delay = Math.min(
      this.nextCheckDate().getTime() - Date.now(),
      2_147_000_000,
    );
    this.timer = setTimeout(async () => {
      try {
        await this.runNow({ source: "schedule" });
      } catch (error) {
        console.error(`Automatic update check failed: ${error.message}`);
      }
    }, Math.max(delay, 1000));
    this.timer.unref?.();
  }
}
