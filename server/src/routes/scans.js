import { Router } from "express";
import { mergeSettings } from "../config/settings.js";
import { collectScanItems } from "../services/scan-sources.js";
import { applyInProgressTracking } from "../services/in-progress-tracker.js";
import { evaluateQueueCommit } from "../services/pending-queue.js";
import { evaluateCleanupItem } from "../services/scan-engine.js";
import { activePendingItems } from "../services/pending-state.js";
import {
  mediaServerConnectionError,
  mediaServerStateError,
  responseForMediaServerError,
} from "../services/media-server-state.js";
import {
  entryFromError,
  entryFromPreviewResult,
} from "../services/run-log.js";
import { isPendingMutationBusy } from "../services/pending-mutation-coordinator.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

const passThroughMutations = {
  run: async (_operation, callback) => callback(),
};

const SKIP_MESSAGES = {
  "already-pending": "This title is already in the pending queue.",
  excluded: "This title is already protected by an exclusion.",
  "genre-excluded": "This title matches an excluded genre.",
  "genre-not-included": "This title does not match the selected included genres.",
  "in-progress": "This title is currently protected as in-progress media.",
  "missing-arr-date": "Scrubarr could not confirm the Arr added date required by Minimum Arr age.",
  "movie-limit": "The maximum pending movie limit has already been reached.",
  "series-limit": "The maximum pending series limit has already been reached.",
  "too-new": "This title has not been in Radarr/Sonarr long enough for the Minimum Arr age rule.",
  "unwatched-rule-not-met": "This title has not reached the never-watched age rule.",
  "watched-rule-not-met": "This title has not reached the watched age rule.",
  "watch-history-unknown": "Scrubarr could not confirm watch history, so this title is skipped for safety.",
  "year-after-filter": "This title is newer than the selected release-year range.",
  "year-before-filter": "This title is older than the selected release-year range.",
  "age-rule-not-met": "This title does not meet the selected watched or never-watched age rules.",
};

function itemDecisionResponse({ item, decision }) {
  const reason = decision.eligible
    ? decision.candidate?.Reason || "This title matches the current cleanup rules."
    : SKIP_MESSAGES[decision.skip] || "This title does not match the current cleanup rules.";
  return {
    item: {
      Title: item.Title,
      Type: item.Type,
      Year: item.Year || null,
      ItemId: item.ItemId,
      Arr: item.Arr || null,
      ArrId: item.ArrId || null,
      HasPrimaryImage: item.HasPrimaryImage,
    },
    eligible: decision.eligible,
    skip: decision.skip || null,
    reason,
    candidate: decision.candidate || null,
  };
}

export function createScansRouter({
  settingsStore,
  exclusionsStore,
  pendingStore,
  inProgressStore,
  defaults,
  timezone,
  scanCoordinator,
  runLog,
  pendingMutations = passThroughMutations,
  onPendingAdded,
  onPendingChanged,
}) {
  const router = Router();

  router.post("/preview", async (_request, response) => {
    const startedAt = new Date().toISOString();
    try {
      const result = await scanCoordinator.preview();
      await runLog.append(
        entryFromPreviewResult({
          source: "manual",
          result,
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      );
      response.json(result);
    } catch (error) {
      await runLog.append(entryFromError({ source: "manual", error, startedAt }));
      const busy = error.code === "scan_operation_in_progress";
      if (error.mediaServerResult) {
        responseForMediaServerError(response, error.mediaServerResult);
        return;
      }
      response.status(busy ? 409 : 502).json({
        error: busy ? error.code : "preview_scan_failed",
        message: error.message || "Preview scan failed",
      });
    }
  });

  router.post("/commit", async (request, response) => {
    if (!scanCoordinator.beginCommit()) {
      response.status(409).json({
        error: "scan_operation_in_progress",
        message: "Another scan operation is already running",
      });
      return;
    }

    const selectedItemIds = Array.isArray(request.body?.itemIds)
      ? [...new Set(request.body.itemIds.map(String))]
      : [];
    if (selectedItemIds.length === 0 || selectedItemIds.length > 500) {
      scanCoordinator.endCommit();
      response.status(400).json({
        error: "invalid_selection",
        message: "Select between 1 and 500 preview items",
      });
      return;
    }

    try {
      const body = await pendingMutations.run("preview-commit", async () => {
        const [saved, exclusions, pending, inProgress] = await Promise.all([
          settingsStore.read(),
          exclusionsStore.read(),
          pendingStore.read(),
          inProgressStore.read(),
        ]);
        const settings = mergeSettings(defaults, saved);
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
        await inProgressStore.write(tracked.records);
        const evaluated = evaluateQueueCommit({
          selectedItemIds,
          items: tracked.items,
          settings,
          exclusions: asList(exclusions),
          pending: asList(pending),
          now: new Date(),
          timezone,
        });

        let librarySync = null;
        let arrTagging = null;
        if (evaluated.records.length > 0) {
          await pendingStore.write([...asList(pending), ...evaluated.records]);
          arrTagging = await onPendingAdded?.(evaluated.records);
          try {
            librarySync = await onPendingChanged?.();
          } catch (error) {
            librarySync = {
              status: "failed",
              message: error.message || "Library sync failed",
            };
          }
        }

        return {
          ok: true,
          added: evaluated.records,
          skippedItemIds: evaluated.skippedItemIds,
          summary: evaluated.summary,
          warnings: collected.warnings,
          arrTagging,
          librarySync,
        };
      });
      response.json(body);
    } catch (error) {
      if (isPendingMutationBusy(error)) {
        response.status(409).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      if (error.mediaServerResult) {
        responseForMediaServerError(response, error.mediaServerResult);
        return;
      }
      response.status(502).json({
        error: "queue_commit_failed",
        message: error.message || "Unable to add selected items",
      });
    } finally {
      scanCoordinator.endCommit();
    }
  });

  router.get("/decision/:itemId", async (request, response) => {
    const itemId = String(request.params.itemId || "").trim();
    if (!itemId) {
      response.status(400).json({
        error: "invalid_item",
        message: "Item ID is required",
      });
      return;
    }

    try {
      const [saved, exclusions, pending, inProgress] = await Promise.all([
        settingsStore.read(),
        exclusionsStore.read(),
        pendingStore.read(),
        inProgressStore.read(),
      ]);
      const settings = mergeSettings(defaults, saved);
      const mediaServerError = mediaServerStateError(settings);
      if (mediaServerError) {
        responseForMediaServerError(response, mediaServerError);
        return;
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
      await inProgressStore.write(tracked.records);
      const item = tracked.items.find(
        (candidate) => String(candidate.ItemId) === itemId,
      );
      if (!item) {
        response.status(404).json({
          error: "item_not_found",
          message: "This title was not found in the configured media libraries.",
        });
        return;
      }

      const activePending = activePendingItems(asList(pending));
      const decision = evaluateCleanupItem({
        item,
        settings,
        exclusions: asList(exclusions),
        activePending,
        now: new Date(),
      });
      response.json(itemDecisionResponse({ item, decision }));
    } catch (error) {
      if (error.mediaServerResult) {
        responseForMediaServerError(response, error.mediaServerResult);
        return;
      }
      response.status(502).json({
        error: "cleanup_decision_failed",
        message: error.message || "Unable to test cleanup decision",
      });
    }
  });

  return router;
}
