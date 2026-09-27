// WhatsApp Cloud API channel (phase 3): what the rest of the app uses. The adapter is registered in
// src/server/channels/registry.ts and the job handlers in src/server/jobs/handlers/index.ts; screens go through
// src/data/whatsapp*.ts, never through this module directly.
import "server-only";

export { createWhatsAppAdapter, eventsForChannel, whatsappAdapter, type WhatsAppAdapterDeps } from "./adapter";
export {
  PIN_PATTERN,
  readWhatsAppConfig,
  readWhatsAppSecrets,
  WHATSAPP_WEBHOOK_PATH,
  whatsappWebhookUrl,
  WhatsAppNotConnectedError,
  type WhatsAppConfig,
  type WhatsAppDeps,
  type WhatsAppSecrets,
} from "./config";
export { REQUIRED_SCOPES, type WhatsAppField, type WhatsAppIdentity, type WhatsAppSummary, type WhatsAppValidation } from "./connect";
export { PAYMENT_ALERT_TITLE } from "./failures";
export { checkWhatsAppHealth, REREGISTER_DAYS, WHATSAPP_HEALTH_LABELS, type WhatsAppHealthKey, type WhatsAppHealthReport } from "./health";
export { MEDIA_DOWNLOAD_JOB } from "./media";
export { normalizeWhatsAppWebhook, UNSUPPORTED_TEXT } from "./normalize";
export { REGISTER_LIMIT, registerAttemptsLeft } from "./numbers";
export {
  cancelWhatsAppJobs,
  ensureWhatsAppHealthChecks,
  enqueueTemplatesSync,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_JOB,
  requestHealthCheckSoon,
  STATUS_RETRY_JOB,
} from "./schedule";
export { chooseDestination, SEND_MAX_ATTEMPTS } from "./send";
export { marketOfConversation, storeCostEstimate } from "./statuses";
export { syncWhatsAppTemplates, TEMPLATES_SYNC_JOB } from "./templates";
export { invalidSignatureStats, processWhatsAppWebhook, verifyWhatsAppWebhook, WEBHOOK_MAX_BYTES } from "./webhook";
