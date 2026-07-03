import { Router } from "express";

export function createSchedulerRouter(scheduler, { getMode } = {}) {
  const router = Router();

  async function status() {
    const current = scheduler.status();
    return {
      ...current,
      mode: getMode ? await getMode() : current.mode,
    };
  }

  router.get("/", async (_request, response, next) => {
    try {
      response.json(await status());
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (request, response) => {
    try {
      await scheduler.update(request.body);
      response.json(await status());
    } catch (error) {
      response.status(400).json({
        error: error.code || "schedule_update_failed",
        message: error.message,
        details: error.details,
      });
    }
  });

  router.post("/run", async (_request, response) => {
    try {
      response.json({ ok: true, run: await scheduler.runNow() });
    } catch (error) {
      const busy = error.code === "scan_operation_in_progress";
      response.status(busy ? 409 : 502).json({
        error: error.code || "scheduled_scan_failed",
        message: error.message,
      });
    }
  });

  return router;
}
