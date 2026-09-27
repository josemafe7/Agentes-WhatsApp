// Email channels (phase 6): Gmail, Outlook / Microsoft 365 and IMAP/SMTP behind the common ChannelAdapter. The
// adapters are registered in src/server/channels/registry.ts and the poll job in src/server/jobs/handlers/index.ts;
// screens go through src/data/email*.ts, never through this module directly.
import "server-only";

export { createEmailAdapter, emailProviderFor, forgetMailboxDraft, gmailAdapter, imapAdapter, outlookAdapter, sendEmail } from "./adapter";
export { businessDayBounds, CAP_REASON_SENDER, CAP_REASON_THREAD, countAiReplies, enforceDailyCaps, reachedCap } from "./caps";
export {
  EMAIL_CHANNEL_TYPES,
  emailConfigSchema,
  isEmailChannelType,
  mailboxAddress,
  readEmailConfig,
  updateEmailConfig,
  type EmailChannelType,
  type EmailConfig,
  type EmailConfigPatch,
  type MailboxDraft,
} from "./config";
export * from "./constants";
export { discardMailboxDraft, discardMailboxDraftOf, syncMailboxDrafts } from "./drafts";
export { classifyEmail, IGNORE_REASON_LABELS, IGNORE_REASONS, type EmailClassification, type IgnoreReason } from "./filters";
export { messageIdFor, outgoingHeaders, replySubject, replyThreading, sendModeOf, type SendMode } from "./headers";
export { cancelEmailJobs, EMAIL_POLL_JOB, ensureEmailPolling, ensureEmailPollingForAll, requestEmailPollSoon, runEmailPoll, type PollOutcome } from "./jobs";
export { emailMetadataSchema, readEmailMetadata, subjectOf, type EmailMetadata } from "./metadata";
export { OAUTH_FAILURE_MESSAGES, OAUTH_FAILURES, oauthFailureMessage, type OAuthFailure } from "./oauth-results";
export { AI_NOTICE_AUTOMATIC, AI_NOTICE_REVIEWED, withEmailSignature } from "./signature";
export { EmailReconnectError, markReconnectRequired, RECONNECT_LABEL } from "./status";
