import { Router } from "express";
import {
  mediaServerConnectionError,
  responseForMediaServerError,
} from "../services/media-server-state.js";

export function createLibrariesRouter({ syncLibraries }) {
  const router = Router();

  router.post("/sync", async (_request, response, next) => {
    try {
      const result = await syncLibraries();
      if (result.skipped) {
        response.status(409).json(result);
        return;
      }
      response.json(result);
    } catch (error) {
      if (error.mediaServerResult) {
        responseForMediaServerError(response, error.mediaServerResult);
        return;
      }
      if (error.settings) {
        responseForMediaServerError(response, mediaServerConnectionError(error.settings));
        return;
      }
      next(error);
    }
  });

  return router;
}
