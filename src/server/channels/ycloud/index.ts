// WhatsApp through YCloud: what the rest of the app uses. The registry gives its adapter to the WhatsApp channels whose
// `connection_mode` is «ycloud» (src/server/channels/registry.ts) and the job handlers are registered in
// src/server/jobs/handlers/index.ts; screens go through src/data/ycloud.ts, never through this module directly.
import "server-only";

export { createYCloudAdapter, ycloudAdapter, type YCloudAdapterDeps } from "./adapter";
export {
  readYCloudConfig,
  readYCloudSecrets,
  ycloudNumberOf,
  ycloudPhoneNumberId,
  ycloudWebhookPath,
  ycloudWebhookUrl,
  YCloudNotConnectedError,
  type YCloudConfig,
  type YCloudDeps,
  type YCloudSecrets,
} from "./config";
export { ensureYCloudWebhook, validateYCloudKey, ycloudCanReceive, type YCloudKeyValidation } from "./connect";
export { checkYCloudHealth, YCLOUD_HEALTH_LABELS, type YCloudHealthKey, type YCloudHealthReport } from "./health";
export { YCLOUD_MEDIA_DOWNLOAD_JOB } from "./media";
export { normalizeYCloudEvent } from "./normalize";
export { cancelYCloudJobs, enqueueYCloudTemplatesSync, ensureYCloudHealthChecks, requestYCloudHealthCheckSoon, YCLOUD_HEALTH_CHECK_JOB } from "./schedule";
export { syncYCloudTemplates, YCLOUD_TEMPLATES_SYNC_JOB } from "./templates";
export { processYCloudWebhook, YCLOUD_WEBHOOK_MAX_BYTES, YCLOUD_WEBHOOK_SOURCE } from "./webhook";
