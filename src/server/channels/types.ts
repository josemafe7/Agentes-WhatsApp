// The common contract of every channel ([CAN-09]–[CAN-17], spec-original §6.1): what it can do (capabilities), how
// it connects and is checked, how its webhooks become normalized events, and how it sends. One adapter per channel
// type (WhatsApp, Gmail, Outlook, IMAP/SMTP, web chat, Telegram); demo channels use the DemoAdapter ([ARR-11]).
import "server-only";
import type { channels, ChannelHealth, MessageError, MessageMedia } from "@/db/schema";
import type { ChannelType, MessageContentType } from "@/lib/enums";
import { AppError } from "@/server/errors";

/** A row of `channels`. Secrets stay encrypted in `secretsEnc`: adapters read them with readChannelSecrets(). */
export type ChannelRecord = typeof channels.$inferSelect;

/** What the inbox offers in a conversation depends on these ([CAN-14]). */
export type ChannelCapabilities = {
  audio: boolean;
  images: boolean;
  documents: boolean;
  /** WhatsApp templates ([WA-42], [WA-43]). */
  templates: boolean;
  /** 24 h customer service window: outside it the AI does not write ([WA-43]). */
  window24h: boolean;
  /** «escribiendo…» while the AI prepares the reply ([WA-45]). */
  typing: boolean;
  /** Read receipts sent to the customer ([WA-45]). */
  readReceipts: boolean;
  /** HTML bodies (email). */
  html: boolean;
  /** «Borrador para revisar» ([CAN-07]). */
  drafts: boolean;
};

// ─── Normalized events (handleWebhook → ingest) ─────────────────────────────────────────────────────────

/** Who wrote: identities in this channel type, most stable first (WhatsApp: BSUID, then wa_id). Never the phone. */
export type InboundSender = {
  /** At least one. The first is the primary identity; the others are added to the same contact ([WA-40]). */
  externalIds: string[];
  /** Data only, never a key ([CAN-13]). Digits, as the channel gives it. */
  phone?: string | null;
  email?: string | null;
  /** Name the channel shows (WhatsApp profile name, email display name). */
  displayName?: string | null;
};

export type InboundMessageEvent = {
  kind: "inbound_message";
  /** Message id in the channel: with the channel it identifies the message once ([CAN-11]). */
  externalId: string;
  sender: InboundSender;
  /** Email thread: one conversation per thread ([CAN-12]). Ignored by other channel types. */
  threadId?: string | null;
  contentType: MessageContentType;
  text?: string | null;
  media?: MessageMedia | null;
  /** When the channel says it was sent (opens the WhatsApp 24 h window, [WA-43]). */
  sentAt: Date;
  /** Injected by the simulator: its replies never leave the app ([AJU-13]). */
  simulated?: boolean;
  /** Stored but never answered by the AI (identity changes, system notices…, [WA-50]). */
  noReply?: boolean;
  /**
   * A reaction to another message ([WA-37]): stored on that message (emoji null = removed), never as a new message
   * and never answered.
   */
  reaction?: { targetExternalId: string; emoji: string | null } | null;
  /** Channel-specific data (email headers, quoted message, interactive payloads…). */
  metadata?: Record<string, unknown>;
};

/** Outbound delivery statuses the channel reports ([WA-38]). */
export type ChannelDeliveryStatus = "sent" | "delivered" | "read" | "played" | "failed";

export type StatusUpdateEvent = {
  kind: "status_update";
  /** Channel id of our outbound message. */
  externalId: string;
  status: ChannelDeliveryStatus;
  at: Date;
  error?: MessageError | null;
  /** Meta pricing: stored from the first status that carries it ([WA-38], [WA-47]). */
  pricing?: { type: string | null; category: string | null } | null;
};

/** Account, quality, template or name notices of the channel ([WA-29]); handled by the channel's own phase. */
export type AccountEvent = {
  kind: "account_event";
  event: string;
  data: Record<string, unknown>;
};

export type NormalizedEvent = InboundMessageEvent | StatusUpdateEvent | AccountEvent;

/** What a webhook route passes to handleWebhook (the signature is already checked by the route, [WA-32]). */
export type WebhookInput = { body: unknown; headers?: Headers };

// ─── Sending ────────────────────────────────────────────────────────────────────────────────────────────

export type OutboundRecipient = {
  /** The contact's identities in this channel type (primary first). */
  externalIds: string[];
  phone: string | null;
  email: string | null;
  name: string | null;
};

export type OutboundMessage = {
  /** Our message id (already stored with status `queued`). */
  messageId: string;
  conversationId: string;
  recipient: OutboundRecipient;
  /** Email thread of the conversation. */
  threadId: string | null;
  contentType: MessageContentType;
  text: string | null;
  media?: MessageMedia | null;
  metadata?: Record<string, unknown>;
};

export type SendResult = {
  /** Channel id of the sent message (status updates find it by this), or null when the channel has none. */
  externalId: string | null;
  status: "queued" | "sent" | "delivered";
  sentAt?: Date;
};

/** A send that failed. `retryable` = a transient error worth one more try ([WA-46]). */
export class ChannelSendError extends AppError {
  constructor(
    userMessage: string,
    readonly retryable: boolean,
    readonly channelCode?: string | number,
  ) {
    super(502, "channel_send_failed", userMessage);
  }
}

// ─── Connecting and media ───────────────────────────────────────────────────────────────────────────────

export type ConnectResult = {
  ok: boolean;
  /** Spanish explanation when it failed. */
  error?: string;
  /** Non-secret config to store (merged into `channels.config`). */
  config?: Record<string, unknown>;
  /** Secrets to store encrypted in `channels.secrets_enc` ([CAN-17]). */
  secrets?: Record<string, unknown>;
};

export type MediaRef = { externalMediaId: string; mimeType?: string | null };
export type DownloadedMedia = { bytes: Uint8Array; mimeType: string; fileName?: string | null };

export interface ChannelAdapter {
  readonly type: ChannelType;
  /** Capabilities of this channel (the web chat's depend on its settings, [WEB-07]). */
  capabilities(channel: ChannelRecord): ChannelCapabilities;
  /** Checks the credentials/settings and returns what to store. Never stores anything itself. */
  validateAndConnect(channel: ChannelRecord, input: unknown): Promise<ConnectResult>;
  /** Traffic lights with Spanish explanations ([CAN-15], [WA-26]). */
  healthCheck(channel: ChannelRecord): Promise<ChannelHealth>;
  /** Turns a verified webhook (or the widget/simulator body) into normalized events. Never calls the AI ([CAN-10]). */
  handleWebhook(channel: ChannelRecord, input: WebhookInput): Promise<NormalizedEvent[]>;
  /** Sends one message; throws ChannelSendError. */
  send(channel: ChannelRecord, message: OutboundMessage): Promise<SendResult>;
  downloadMedia(channel: ChannelRecord, ref: MediaRef): Promise<DownloadedMedia>;
  markRead?(channel: ChannelRecord, externalMessageId: string): Promise<void>;
  sendTyping?(channel: ChannelRecord, externalMessageId: string): Promise<void>;
  /** Releases what the channel holds outside (subscriptions, webhooks). Credentials are deleted by the caller. */
  disconnect(channel: ChannelRecord, options?: { deregister?: boolean }): Promise<void>;
}
