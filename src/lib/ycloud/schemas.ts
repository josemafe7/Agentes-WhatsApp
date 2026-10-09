// Zod schemas of what the product reads from YCloud's API and webhooks (docs/integracion-ycloud.md). Unknown fields
// are dropped (YCloud adds fields without notice); a webhook is validated only AFTER its signature ([YC-05]) and what
// it carries is data, never instructions ([SEG-05]). YCloud mixes camelCase of its own (`fromUserId`, `sendTime`) with
// Meta's snake_case inside the message content (`mime_type`, `message_id`): both are kept as they come.
import { z } from "zod";

const text = (max: number) => z.string().max(max);
/** Ids are opaque, case-sensitive strings of up to 255 characters («Versioning»). */
const ycloudId = z.string().min(1).max(255);

// ─── Errors ─────────────────────────────────────────────────────────────────────────────────────────────

export const ycloudErrorBodySchema = z.object({
  error: z.object({
    status: z.number().int().nullish(),
    code: text(100).nullish(),
    message: z.string().nullish(),
    whatsappApiError: z
      .object({ code: z.union([z.string(), z.number()]).nullish(), is_transient: z.boolean().nullish() })
      .nullish(),
  }),
});

// ─── Account, numbers and templates ─────────────────────────────────────────────────────────────────────

export const ycloudBalanceSchema = z.object({ amount: z.number(), currency: text(10).nullish() });
export type YCloudBalance = z.infer<typeof ycloudBalanceSchema>;

export const ycloudPhoneNumberSchema = z.object({
  id: ycloudId.nullish(),
  /** E.164, with «+». */
  phoneNumber: text(40).min(1),
  displayPhoneNumber: text(60).nullish(),
  wabaId: ycloudId,
  verifiedName: text(300).nullish(),
  qualityRating: text(40).nullish(),
  messagingLimit: text(60).nullish(),
  status: text(40).nullish(),
  codeVerificationStatus: text(40).nullish(),
  nameStatus: text(60).nullish(),
});
export type YCloudPhoneNumber = z.infer<typeof ycloudPhoneNumberSchema>;

/** A page of a list: go on while `length` equals `limit` («Pagination»). */
export const ycloudPageSchema = z.object({ items: z.array(z.unknown()), length: z.number().int().nonnegative().nullish(), limit: z.number().int().positive().nullish() });

export const ycloudTemplateSchema = z.object({
  officialTemplateId: ycloudId.nullish(),
  wabaId: ycloudId.nullish(),
  name: text(600).min(1),
  language: text(20).min(1),
  category: text(40).nullish(),
  status: text(40).nullish(),
  reason: text(200).nullish(),
  components: z.array(z.unknown()).nullish(),
});
export type YCloudTemplate = z.infer<typeof ycloudTemplateSchema>;

export const ycloudWebhookEndpointSchema = z.object({
  id: ycloudId,
  url: text(600).nullish(),
  enabledEvents: z.array(text(100)).nullish(),
  status: text(40).nullish(),
  /** `whsec_…`: only read when the endpoint is created. */
  secret: text(300).nullish(),
});
export type YCloudWebhookEndpoint = z.infer<typeof ycloudWebhookEndpointSchema>;

export const ycloudMediaUploadSchema = z.object({ id: ycloudId });

// ─── Messages ───────────────────────────────────────────────────────────────────────────────────────────

/** What a send answers, and what a status update or an echo carries. */
export const ycloudMessageSchema = z.object({
  id: ycloudId,
  wamid: text(400).nullish(),
  wabaId: ycloudId.nullish(),
  from: text(40).nullish(),
  to: text(40).nullish(),
  toUserId: text(200).nullish(),
  recipientUserId: text(200).nullish(),
  type: text(40).nullish(),
  status: text(40).nullish(),
  errorCode: z.union([z.string(), z.number()]).nullish(),
  errorMessage: z.string().nullish(),
  whatsappApiError: z.object({ code: z.union([z.string(), z.number()]).nullish(), is_transient: z.boolean().nullish() }).nullish(),
  pricingType: text(60).nullish(),
  pricingCategory: text(60).nullish(),
  createTime: text(60).nullish(),
  sendTime: text(60).nullish(),
  deliverTime: text(60).nullish(),
  readTime: text(60).nullish(),
  updateTime: text(60).nullish(),
  customerProfile: z.object({ name: text(300).nullish(), username: text(300).nullish() }).nullish(),
  text: z.object({ body: text(20_000).nullish() }).nullish(),
});
export type YCloudMessage = z.infer<typeof ycloudMessageSchema>;

/** A customer's message: its content objects are Meta's own, read by the WhatsApp normalizer. */
export const ycloudInboundMessageSchema = z.object({
  id: ycloudId,
  wamid: text(400).nullish(),
  wabaId: ycloudId.nullish(),
  /** E.164; may be missing for a customer with a WhatsApp user name. */
  from: text(40).nullish(),
  fromUserId: text(200).nullish(),
  customerProfile: z.object({ name: text(300).nullish(), username: text(300).nullish() }).nullish(),
  to: text(40).min(1),
  sendTime: text(60).nullish(),
  type: text(60).min(1),
});
export type YCloudInboundMessage = z.infer<typeof ycloudInboundMessageSchema>;

/** The envelope of every webhook: `id` identifies the event once; one payload key says what it carries. */
export const ycloudEventSchema = z.object({
  id: ycloudId,
  type: text(120).min(1),
  createTime: text(60).nullish(),
  whatsappInboundMessage: z.unknown().optional(),
  whatsappMessage: z.unknown().optional(),
  whatsappTemplate: z.unknown().optional(),
  whatsappPhoneNumber: z.unknown().optional(),
  whatsappBusinessAccount: z.unknown().optional(),
});
export type YCloudEvent = z.infer<typeof ycloudEventSchema>;
