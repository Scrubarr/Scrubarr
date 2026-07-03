import { Router } from "express";
import {
  createLogsZip,
  formatAppLogExport,
  formatRunLogExport,
  logExportFileName,
  logsZipFileName,
} from "../services/log-export.js";

export function createLogsRouter({ runLog, appLog }) {
  const router = Router();

  router.get("/", async (request, response, next) => {
    try {
      const requested = Number.parseInt(request.query.limit || "100", 10);
      const limit = Number.isInteger(requested)
        ? Math.min(Math.max(requested, 1), 200)
        : 100;
      response.json({ entries: await runLog.list({ limit }) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/file", async (request, response, next) => {
    try {
      response.json(await runLog.file());
    } catch (error) {
      next(error);
    }
  });

  router.get("/app-file", async (request, response, next) => {
    try {
      response.json(await appLog.file());
    } catch (error) {
      next(error);
    }
  });

  router.get("/export", async (request, response, next) => {
    try {
      const now = new Date();

      if (request.query.type) {
        const type = request.query.type === "app" ? "app" : "run";
        const content =
          type === "app"
            ? formatAppLogExport((await appLog.file()).content)
            : formatRunLogExport(await runLog.list({ limit: 200 }));
        response
          .type("text/plain")
          .attachment(logExportFileName(type, now))
          .send(content);
        return;
      }

      const runContent = formatRunLogExport(await runLog.list({ limit: 200 }));
      const appContent = formatAppLogExport((await appLog.file()).content);
      const archive = createLogsZip(
        [
          { name: logExportFileName("run", now), content: runContent },
          { name: logExportFileName("app", now), content: appContent },
        ],
        now,
      );
      response
        .type("application/zip")
        .attachment(logsZipFileName(now))
        .send(archive);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
