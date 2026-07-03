import { mergeSettings } from "../config/settings.js";
import { collectScanItems } from "./scan-sources.js";
import { previewScan } from "./scan-engine.js";
import { applyInProgressTracking } from "./in-progress-tracker.js";
import {
  mediaServerConnectionError,
  mediaServerStateError,
} from "./media-server-state.js";
import {
  createPendingRecords,
  formatDateInTimezone,
} from "./pending-queue.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

export class ScanCoordinator {
  constructor({
    settingsStore,
    exclusionsStore,
    pendingStore,
    inProgressStore,
    defaults,
  }) {
    this.settingsStore = settingsStore;
    this.exclusionsStore = exclusionsStore;
    this.pendingStore = pendingStore;
    this.inProgressStore = inProgressStore;
    this.defaults = defaults;
    this.previewRunning = false;
    this.commitRunning = false;
  }

  isBusy() {
    return this.previewRunning || this.commitRunning;
  }

  async buildPreview({ now = new Date() } = {}) {
    const [saved, exclusions, pending, inProgress] = await Promise.all([
      this.settingsStore.read(),
      this.exclusionsStore.read(),
      this.pendingStore.read(),
      this.inProgressStore.read(),
    ]);
    const settings = mergeSettings(this.defaults, saved);
    const mediaServerError = mediaServerStateError(settings);
    if (mediaServerError) {
      const error = new Error(mediaServerError.message);
      error.mediaServerResult = mediaServerError;
      throw error;
    }
    let collected;
    try {
      collected = await collectScanItems(settings);
    } catch (error) {
      error.mediaServerResult = mediaServerConnectionError(settings);
      throw error;
    }
    const tracked = applyInProgressTracking({
      items: collected.items,
      records: inProgress,
    });
    await this.inProgressStore.write(tracked.records);

    return {
      pending: asList(pending),
      result: previewScan({
        items: tracked.items,
        settings,
        exclusions: asList(exclusions),
        pending: asList(pending),
        now,
        warnings: collected.warnings,
      }),
    };
  }

  async preview() {
    if (this.isBusy()) {
      const error = new Error("A scan operation is already running");
      error.code = "scan_operation_in_progress";
      throw error;
    }

    this.previewRunning = true;
    try {
      return (await this.buildPreview()).result;
    } finally {
      this.previewRunning = false;
    }
  }

  beginCommit() {
    if (this.isBusy()) return false;
    this.commitRunning = true;
    return true;
  }

  endCommit() {
    this.commitRunning = false;
  }

  async commitEligibleCandidates({ timezone, now = new Date() } = {}) {
    if (!this.beginCommit()) {
      const error = new Error("A scan operation is already running");
      error.code = "scan_operation_in_progress";
      throw error;
    }

    try {
      const { pending, result } = await this.buildPreview({ now });
      const records = createPendingRecords(
        result.candidates,
        formatDateInTimezone(now, timezone),
      );
      if (records.length > 0) {
        await this.pendingStore.write([...pending, ...records]);
      }

      const queuedMovies = records.filter((item) => item.Type === "Movie").length;
      const queuedSeries = records.filter((item) => item.Type === "Series").length;
      return {
        added: records,
        result: {
          ...result,
          readOnly: false,
          queue: {
            added: records.length,
            movies: queuedMovies,
            series: queuedSeries,
          },
        },
      };
    } finally {
      this.endCommit();
    }
  }
}
