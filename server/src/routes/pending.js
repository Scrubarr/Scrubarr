import { Router } from "express";
import {
  appendExclusion,
  exclusionFromPending,
  removePendingItem,
} from "../services/pending-queue.js";
import { pendingDeletionSummary } from "../services/pending-summary.js";
import {
  activePendingItems,
  isActivePendingItem,
} from "../services/pending-state.js";
import { mergeSettings } from "../config/settings.js";
import { isPendingMutationBusy } from "../services/pending-mutation-coordinator.js";
import {
  pendingIntegrityReport,
  pendingItemKey,
} from "../services/pending-integrity.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

const passThroughMutations = {
  run: async (_operation, callback) => callback(),
};

export function createPendingRouter({
  pendingStore,
  exclusionsStore,
  settingsStore,
  defaults,
  timezone,
  librarySyncManifestDirectory,
  pendingMutations = passThroughMutations,
  onPendingRemoved,
  onPendingChanged,
}) {
  const router = Router();

  router.get("/summary", async (_request, response, next) => {
    try {
      const [pending, savedSettings] = await Promise.all([
        pendingStore.read(),
        settingsStore.read(),
      ]);
      response.json(
        pendingDeletionSummary({
          pending,
          settings: mergeSettings(defaults, savedSettings),
          timezone,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (request, response, next) => {
    try {
      const pending = asList(await pendingStore.read());
      response.json(
        request.query.includeDeleted === "true"
          ? pending
          : activePendingItems(pending),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/integrity", async (_request, response, next) => {
    try {
      const [pending, savedSettings] = await Promise.all([
        pendingStore.read(),
        settingsStore.read(),
      ]);
      response.json(
        await pendingIntegrityReport({
          pending,
          settings: mergeSettings(defaults, savedSettings),
          manifestDirectory: librarySyncManifestDirectory,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  router.delete("/stale", async (_request, response, next) => {
    try {
      const result = await pendingMutations.run("pending-remove-stale", async () => {
        const [pending, savedSettings] = await Promise.all([
          pendingStore.read(),
          settingsStore.read(),
        ]);
        const settings = mergeSettings(defaults, savedSettings);
        const report = await pendingIntegrityReport({
          pending,
          settings,
          manifestDirectory: librarySyncManifestDirectory,
        });
        const staleKeys = new Set(report.items.map((item) => item.key));
        const remaining = asList(pending).filter(
          (item) => !isActivePendingItem(item) || !staleKeys.has(pendingItemKey(item)),
        );
        const removed = asList(pending).filter(
          (item) => isActivePendingItem(item) && staleKeys.has(pendingItemKey(item)),
        );

        if (removed.length > 0) {
          await pendingStore.write(remaining);
          await onPendingRemoved?.(removed);
        }

        let librarySync = null;
        if (removed.length > 0) {
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
          status: 200,
          body: {
            ok: true,
            removed,
            removedCount: removed.length,
            report,
            librarySync,
          },
        };
      });
      response.status(result.status).json(result.body);
    } catch (error) {
      if (isPendingMutationBusy(error)) {
        response.status(409).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      next(error);
    }
  });

  router.delete("/:itemId", async (request, response, next) => {
    try {
      const result = await pendingMutations.run("pending-remove", async () => {
        const removal = removePendingItem(
          await pendingStore.read(),
          request.params.itemId,
        );
        if (!removal.removed) {
          return {
            status: 404,
            body: { error: "pending_item_not_found" },
          };
        }
        await pendingStore.write(removal.remaining);
        await onPendingRemoved?.([removal.removed]);
        let librarySync = null;
        try {
          librarySync = await onPendingChanged?.();
        } catch (error) {
          librarySync = {
            status: "failed",
            message: error.message || "Library sync failed",
          };
        }
        return {
          status: 200,
          body: { ok: true, removed: removal.removed, librarySync },
        };
      });
      response.status(result.status).json(result.body);
    } catch (error) {
      if (isPendingMutationBusy(error)) {
        response.status(409).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      next(error);
    }
  });

  router.post("/:itemId/exclude", async (request, response, next) => {
    try {
      const result = await pendingMutations.run(
        "pending-remove-exclude",
        async () => {
          const removal = removePendingItem(
            await pendingStore.read(),
            request.params.itemId,
          );
          if (!removal.removed) {
            return {
              status: 404,
              body: { error: "pending_item_not_found" },
            };
          }

          const exclusion = exclusionFromPending(removal.removed);
          const exclusions = appendExclusion(
            await exclusionsStore.read(),
            exclusion,
          );

          // Persist protection first. If the queue write fails, the safer state is
          // an excluded item that remains visible in the pending queue.
          await exclusionsStore.write(exclusions);
          await pendingStore.write(removal.remaining);
          await onPendingRemoved?.([removal.removed]);
          let librarySync = null;
          try {
            librarySync = await onPendingChanged?.();
          } catch (error) {
            librarySync = {
              status: "failed",
              message: error.message || "Library sync failed",
            };
          }
          return {
            status: 200,
            body: {
              ok: true,
              removed: removal.removed,
              exclusion,
              librarySync,
            },
          };
        },
      );
      response.status(result.status).json(result.body);
    } catch (error) {
      if (isPendingMutationBusy(error)) {
        response.status(409).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      next(error);
    }
  });

  return router;
}

