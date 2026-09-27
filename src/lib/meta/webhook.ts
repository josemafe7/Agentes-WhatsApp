// Zod schemas of WhatsApp webhook payloads (docs/integracion-whatsapp-mensajes.md §5–§9). Validated only AFTER the
// signature ([WA-32]); unknown fields are ignored (Meta adds fields often) and an odd message or status is skipped
// instead of dropping the whole batch. The payload is data, never instructions ([SEG-05]).
import { z } from "zod";
import { metaId } from "./schemas";

const text = (max: number) => z.string().max(max);
/** Unix seconds as a string (messages, statuses) or a number. */
const unixSeconds = z.union([z.string().regex(/^\d{1,12}$/), z.number().int().nonnegative()]).transform((value) => Number(value));

export const webhookEnvelopeSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z
    .array(
      z.object({
        id: metaId,
        time: z.number().nullish(),
        changes: z.array(z.object({ field: z.string().min(1).max(100), value: z.unknown() })).max(1_000).nullish(),
      }),
    )
    // Meta sends up to 1,000 updates per POST (docs/integracion-whatsapp-mensajes.md §4).
    .max(1_000),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export const messagesValueSchema = z.object({
  metadata: z.object({ display_phone_number: text(40).nullish(), phone_number_id: metaId }),
  contacts: z.array(z.unknown()).nullish(),
  messages: z.array(z.unknown()).nullish(),
  statuses: z.array(z.unknown()).nullish(),
  errors: z.array(z.unknown()).nullish(),
});
export type MessagesValue = z.infer<typeof messagesValueSchema>;

export const webhookContactSchema = z.object({
  profile: z.object({ name: text(300).nullish(), username: text(300).nullish() }).nullish(),
  wa_id: text(40).nullish(),
  user_id: text(200).nullish(),
});
export type WebhookContact = z.infer<typeof webhookContactSchema>;

export const webhookErrorSchema = z.object({
  code: z.number().int().nullish(),
  title: text(500).nullish(),
  message: text(1_000).nullish(),
  error_data: z.object({ details: text(1_000).nullish() }).nullish(),
});
export type WebhookError = z.infer<typeof webhookErrorSchema>;

export const webhookMediaSchema = z.object({
  id: metaId,
  mime_type: text(200).nullish(),
  sha256: text(200).nullish(),
  url: text(4_000).nullish(),
  caption: text(4_096).nullish(),
  filename: text(1_000).nullish(),
  voice: z.boolean().nullish(),
  animated: z.boolean().nullish(),
});
export type WebhookMedia = z.infer<typeof webhookMediaSchema>;

export const webhookMessageSchema = z.object({
  id: z.string().min(1).max(300),
  from: text(40).nullish(),
  from_user_id: text(200).nullish(),
  timestamp: unixSeconds,
  type: z.string().min(1).max(40),
  context: z
    .object({
      from: text(40).nullish(),
      id: text(300).nullish(),
      forwarded: z.boolean().nullish(),
      frequently_forwarded: z.boolean().nullish(),
    })
    .nullish(),
  referral: z
    .object({
      source_url: text(2_000).nullish(),
      source_id: text(200).nullish(),
      source_type: text(40).nullish(),
      headline: text(1_000).nullish(),
      body: text(2_000).nullish(),
      ctwa_clid: text(500).nullish(),
    })
    .nullish(),
  text: z.object({ body: text(8_192) }).nullish(),
  audio: webhookMediaSchema.nullish(),
  image: webhookMediaSchema.nullish(),
  video: webhookMediaSchema.nullish(),
  document: webhookMediaSchema.nullish(),
  sticker: webhookMediaSchema.nullish(),
  location: z
    .object({ latitude: z.number(), longitude: z.number(), name: text(1_000).nullish(), address: text(1_000).nullish(), url: text(2_000).nullish() })
    .nullish(),
  contacts: z
    .array(
      z.object({
        name: z.object({ formatted_name: text(300).nullish() }).nullish(),
        phones: z.array(z.object({ phone: text(60).nullish(), wa_id: text(40).nullish(), type: text(40).nullish() })).nullish(),
        emails: z.array(z.object({ email: text(300).nullish() })).nullish(),
        org: z.object({ company: text(300).nullish() }).nullish(),
        origin: text(40).nullish(),
      }),
    )
    .max(50)
    .nullish(),
  interactive: z
    .object({
      type: text(40),
      button_reply: z.object({ id: text(300), title: text(300) }).nullish(),
      list_reply: z.object({ id: text(300), title: text(300), description: text(500).nullish() }).nullish(),
      nfm_reply: z.object({ name: text(100).nullish(), body: text(4_096).nullish(), response_json: text(20_000).nullish() }).nullish(),
    })
    .nullish(),
  button: z.object({ payload: text(1_000).nullish(), text: text(1_000).nullish() }).nullish(),
  reaction: z.object({ message_id: text(300), emoji: text(40).nullish() }).nullish(),
  system: z
    .object({
      body: text(1_000).nullish(),
      type: text(60).nullish(),
      wa_id: text(40).nullish(),
      user_id: text(200).nullish(),
      previous_user_id: text(200).nullish(),
    })
    .nullish(),
  unsupported: z.object({ type: text(60).nullish() }).nullish(),
  errors: z.array(webhookErrorSchema).max(20).nullish(),
});
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;

export const webhookStatusSchema = z.object({
  id: z.string().min(1).max(300),
  status: z.string().min(1).max(40),
  timestamp: unixSeconds,
  recipient_id: text(40).nullish(),
  recipient_user_id: text(200).nullish(),
  errors: z.array(webhookErrorSchema).max(20).nullish(),
  pricing: z
    .object({ billable: z.boolean().nullish(), pricing_model: text(40).nullish(), type: text(60).nullish(), category: text(60).nullish() })
    .nullish(),
});
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;

/** Parses every entry of a list, skipping the ones that do not match. */
export function parseEach<T extends z.ZodType>(schema: T, entries: readonly unknown[] | null | undefined): z.infer<T>[] {
  return (entries ?? []).flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
