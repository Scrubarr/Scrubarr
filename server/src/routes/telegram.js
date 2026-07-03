import { Router } from "express";
import {
  mergeSettings,
  mergeSubmittedSecrets,
} from "../config/settings.js";
import {
  formatTestMessage,
  sendTelegramMessage,
} from "../services/telegram.js";

async function loadSettings(settingsStore, defaults) {
  return mergeSettings(defaults, await settingsStore.read());
}

export function createTelegramRouter({
  settingsStore,
  defaults,
}) {
  const router = Router();

  router.post("/test-message", async (request, response) => {
    try {
      const current = await loadSettings(settingsStore, defaults);
      const draft = mergeSettings(current, request.body || {});
      const settings = mergeSubmittedSecrets(current, draft);
      const result = await sendTelegramMessage(
        settings.Telegram,
        formatTestMessage(),
      );
      response.json({
        ok: true,
        message: `Test message sent to chat ${settings.Telegram.ChatID}.`,
        messageCount: result.messageCount,
      });
    } catch (error) {
      response.status(400).json({
        error: "telegram_send_failed",
        message: error.message || "Telegram test message failed",
      });
    }
  });

  return router;
}
