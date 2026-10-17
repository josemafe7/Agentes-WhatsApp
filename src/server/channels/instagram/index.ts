// Instagram channel: what the rest of the app uses. The adapter is registered in src/server/channels/registry.ts and the
// job handlers in src/server/jobs/handlers/index.ts; screens go through src/data/instagram.ts, never through this module
// directly.
import "server-only";

export { createInstagramAdapter, instagramAdapter, type InstagramAdapterDeps } from "./adapter";
export {
  instagramProfileLink,
  instagramWebhookPath,
  instagramWebhookUrl,
  InstagramNotConnectedError,
  readInstagramConfig,
  readInstagramSecrets,
  type InstagramConfig,
  type InstagramDeps,
  type InstagramSecrets,
} from "./config";
export { validateInstagramToken, type InstagramAccountIdentity, type InstagramValidation } from "./connect";
export { INSTAGRAM_FILE_ECHO_TEXT, INSTAGRAM_PAUSE_REASON, INSTAGRAM_SENDER_NAME, runInstagramEcho } from "./echo";
export { checkInstagramHealth, INSTAGRAM_HEALTH_LABELS, runInstagramHealthCheck, type InstagramHealthKey, type InstagramHealthReport } from "./health";
export { INSTAGRAM_MEDIA_CAPS } from "./media";
export { normalizeInstagramWebhook, type NormalizedInstagramWebhook } from "./normalize";
export {
  cancelInstagramJobs,
  ensureInstagramHealthChecks,
  INSTAGRAM_HEALTH_CHECK_JOB,
  INSTAGRAM_MEDIA_DOWNLOAD_JOB,
  INSTAGRAM_PROFILE_JOB,
  requestInstagramHealthCheckSoon,
} from "./schedule";
export { INSTAGRAM_TEXT_ONLY, sendInstagramMessage } from "./send";
export { INSTAGRAM_WEBHOOK_MAX_BYTES, INSTAGRAM_WEBHOOK_SOURCE, processInstagramWebhook, verifyInstagramWebhook } from "./webhook";
