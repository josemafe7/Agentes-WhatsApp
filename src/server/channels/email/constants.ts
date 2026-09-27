// Constants shared by the three email connectors (pure: filters and headers use them without the database).

/** Every message the app sends carries it, and mail that arrives with it is never answered ([COR-18]). */
export const DOMINIA_HEADER = "X-DominIA-Agente";
export const DOMINIA_HEADER_VALUE = "1";
/** The system mail's header (src/server/mailer.ts): also ours. */
export const SYSTEM_MAIL_HEADER = "X-DominIA-System";

/** Defaults of the daily caps of AI replies per thread and per sender ([COR-17]). */
export const DEFAULT_DAILY_CAP_PER_THREAD = 5;
export const DEFAULT_DAILY_CAP_PER_SENDER = 10;
/**
 * AI replies a mailbox sends in a day, all its threads and senders together ([COR-17]): many senders each under their
 * own cap still stop here. Fixed (docs/spec.md), under the daily sending limits of Gmail and Outlook.com mailboxes.
 */
export const DAILY_CAP_PER_CHANNEL = 200;
export const MAX_DAILY_CAP = 100;
export const MAX_SIGNATURE = 1_000;

/** Each mailbox is polled at most this often (a recurring job per channel inside tick()). */
export const EMAIL_POLL_INTERVAL_MS = 60_000;
/** Polls failed in a row before the channel shows «error» ([CAN-15]). */
export const MAX_SYNC_FAILURES = 3;

/** Largest message read whole; a bigger one is stored with its headers only and a note ([COR-19]). */
export const MAX_EMAIL_BYTES = 40 * 1024 * 1024;
/** Characters of an email's text the model and the inbox get; the rest is cut with a note. */
export const MAX_EMAIL_TEXT = 20_000;
/** Full original text kept in the message metadata when the cleaned text differs ([COR-19]). */
export const MAX_ORIGINAL_TEXT = 100_000;
/** Inline images (cid:) smaller than this are signature logos: dropped (docs/integracion-correo.md §5). */
export const MIN_INLINE_IMAGE_BYTES = 30 * 1024;
/** At most this many attachments of one email are stored. */
export const MAX_ATTACHMENTS = 10;
