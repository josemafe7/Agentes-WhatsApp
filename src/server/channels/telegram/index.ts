// Telegram channel: what the rest of the app uses. The adapter is registered in src/server/channels/registry.ts and the
// job handlers in src/server/jobs/handlers/index.ts; screens go through src/data/telegram.ts, never through this module
// directly.
import "server-only";

export { createTelegramAdapter, telegramAdapter, type TelegramAdapterDeps } from "./adapter";
export {
  readTelegramConfig,
  readTelegramSecrets,
  telegramBotLink,
  telegramWebhookPath,
  telegramWebhookUrl,
  TelegramNotConnectedError,
  type TelegramConfig,
  type TelegramDeps,
  type TelegramReceiveMode,
  type TelegramSecrets,
} from "./config";
export { activateTelegramReceiving, telegramReceiveModeFor, validateTelegramToken, type TelegramBotIdentity, type TelegramValidation } from "./connect";
export { checkTelegramHealth, TELEGRAM_HEALTH_LABELS, type TelegramHealthKey, type TelegramHealthReport } from "./health";
export { TELEGRAM_MEDIA_DOWNLOAD_JOB } from "./media";
export { normalizeTelegramUpdate, telegramExternalId } from "./normalize";
export {
  cancelTelegramJobs,
  cancelTelegramPolling,
  ensureTelegramHealthChecks,
  ensureTelegramPolling,
  requestTelegramHealthCheckSoon,
  TELEGRAM_HEALTH_CHECK_JOB,
  TELEGRAM_POLL_JOB,
} from "./schedule";
export { ingestTelegramUpdate, processTelegramWebhook, TELEGRAM_SECRET_HEADER, TELEGRAM_WEBHOOK_MAX_BYTES, TELEGRAM_WEBHOOK_SOURCE } from "./webhook";
