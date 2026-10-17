// What Instagram answers and sends, as docs/integracion-instagram.md documents it (official shapes, checked 16-10-2026).
// Anything not documented is optional; unknown keys are ignored. Pure: shared by the client, the webhook and the tests.
import { z } from "zod";

/** Graph ids arrive as strings; a number is turned into its digits. */
const idString = z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).transform((value) => String(value));

export const graphErrorBodySchema = z.object({
  error: z.object({
    message: z.string().nullish(),
    type: z.string().nullish(),
    code: z.number().int().nullish(),
    error_subcode: z.number().int().nullish(),
    is_transient: z.boolean().nullish(),
    fbtrace_id: z.string().nullish(),
  }),
});

/** `GET /me` (§2.3): `user_id` is the professional account's id, the one webhooks carry in `entry[].id`. */
const meFields = z.object({
  user_id: idString,
  id: idString.nullish(),
  username: z.string().min(1).max(100),
  name: z.string().max(300).nullish(),
  account_type: z.string().max(40).nullish(),
});
/** The guide's example wraps it in `data: [ … ]`; the reference does not: both are accepted (§2.3). */
export const meSchema = z.union([meFields, z.object({ data: z.array(meFields).min(1) }).transform((body) => body.data[0])]);
export type InstagramAccount = z.infer<typeof meFields>;

export const successSchema = z.object({ success: z.boolean() });

/** `POST /me/messages` (§6.1). */
export const sentMessageSchema = z.object({ recipient_id: idString.nullish(), message_id: z.string().min(1).max(512) });
export type InstagramSentMessage = z.infer<typeof sentMessageSchema>;

/** `GET /refresh_access_token` (§2.2): `expires_in` in seconds. */
export const refreshedTokenSchema = z.object({ access_token: z.string().min(1).max(2_000), token_type: z.string().nullish(), expires_in: z.number().int().positive() });
export type InstagramRefreshedToken = z.infer<typeof refreshedTokenSchema>;

/** `GET /<IGSID>?fields=name,username` (§9): both may be null. */
export const userProfileSchema = z.object({ name: z.string().max(300).nullish(), username: z.string().max(100).nullish() });
export type InstagramUserProfile = z.infer<typeof userProfileSchema>;

// ─── Webhooks (§5) ──────────────────────────────────────────────────────────────────────────────────────

const attachmentSchema = z.object({
  type: z.string().max(40),
  payload: z.object({ url: z.string().max(4_096).nullish(), title: z.string().max(1_000).nullish() }).passthrough().nullish(),
});

export const webhookMessageSchema = z.object({
  mid: z.string().min(1).max(512),
  text: z.string().max(20_000).nullish(),
  attachments: z.array(attachmentSchema).max(20).nullish(),
  is_echo: z.boolean().nullish(),
  is_self: z.boolean().nullish(),
  is_deleted: z.boolean().nullish(),
  is_unsupported: z.boolean().nullish(),
  quick_reply: z.object({ payload: z.string().max(1_000).nullish() }).nullish(),
  reply_to: z.object({ mid: z.string().max(512).nullish(), story: z.object({ url: z.string().max(4_096).nullish(), id: idString.nullish() }).passthrough().nullish() }).passthrough().nullish(),
});
export type InstagramWebhookMessage = z.infer<typeof webhookMessageSchema>;

export const webhookEventSchema = z.object({
  sender: z.object({ id: idString }),
  recipient: z.object({ id: idString }),
  timestamp: z.number().nonnegative(),
  message: webhookMessageSchema.nullish(),
  reaction: z.object({ mid: z.string().min(1).max(512), action: z.string().max(20), reaction: z.string().max(40).nullish(), emoji: z.string().max(40).nullish() }).nullish(),
  read: z.object({ mid: z.string().min(1).max(512) }).nullish(),
});
export type InstagramWebhookEvent = z.infer<typeof webhookEventSchema>;

export const webhookBodySchema = z.object({
  object: z.literal("instagram"),
  entry: z
    .array(
      z.object({
        id: idString,
        time: z.number().nonnegative().nullish(),
        /** Each event is parsed on its own: one odd event never drops the others. */
        messaging: z.array(z.unknown()).max(1_000).nullish(),
      }),
    )
    .max(1_000),
});
export type InstagramWebhookBody = z.infer<typeof webhookBodySchema>;

/** Meta sends `timestamp` in milliseconds in its examples; 10 digits would be seconds (§5.1). */
export function instantOf(timestamp: number): Date {
  return new Date(timestamp < 100_000_000_000 ? timestamp * 1_000 : timestamp);
}
