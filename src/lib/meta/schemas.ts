// Zod schemas of the Graph API responses the product uses (docs/integracion-whatsapp.md §3–§5, docs/integracion-
// whatsapp-mensajes.md §10–§12). Unknown fields are dropped; odd entries of a list are skipped by the client.
import { z } from "zod";

/** Meta sends most ids as strings, some as numbers (template ids in webhooks). Always a string here. */
export const metaId = z.union([z.string().min(1).max(200), z.number().int().nonnegative()]).transform((value) => String(value));

export const graphErrorBodySchema = z.object({
  error: z.object({
    message: z.string().nullish(),
    type: z.string().nullish(),
    code: z.number().int().nullish(),
    error_subcode: z.number().int().nullish(),
    is_transient: z.boolean().nullish(),
    error_data: z.object({ details: z.string().nullish() }).nullish(),
    fbtrace_id: z.string().nullish(),
  }),
});

export const successSchema = z.object({ success: z.boolean() });

// ─── Phone number ([WA-05], [WA-08], [WA-26]) ───────────────────────────────────────────────────────────

export const healthEntitySchema = z.object({
  entity_type: z.string(),
  id: metaId.nullish(),
  can_send_message: z.string().nullish(),
  additional_info: z.array(z.string()).nullish(),
  errors: z
    .array(z.object({ error_code: z.number().nullish(), error_description: z.string().nullish(), possible_solution: z.string().nullish() }))
    .nullish(),
});
export type HealthEntity = z.infer<typeof healthEntitySchema>;

export const healthStatusSchema = z.object({
  can_send_message: z.string().nullish(),
  entities: z.array(z.unknown()).nullish(),
});

export const webhookConfigurationSchema = z.object({
  application: z.string().nullish(),
  phone_number: z.string().nullish(),
  whatsapp_business_account: z.string().nullish(),
});
export type WebhookConfiguration = z.infer<typeof webhookConfigurationSchema>;

export const phoneNumberSchema = z.object({
  id: metaId,
  display_phone_number: z.string().nullish(),
  verified_name: z.string().nullish(),
  quality_rating: z.string().nullish(),
  code_verification_status: z.string().nullish(),
  name_status: z.string().nullish(),
  new_display_name: z.string().nullish(),
  new_name_status: z.string().nullish(),
  status: z.string().nullish(),
  whatsapp_business_manager_messaging_limit: z.string().nullish(),
  health_status: healthStatusSchema.nullish(),
  webhook_configuration: webhookConfigurationSchema.nullish(),
});
export type PhoneNumberResponse = z.infer<typeof phoneNumberSchema>;

// ─── WABA (Messaging account), tokens and subscriptions ─────────────────────────────────────────────────

export const wabaSchema = z.object({
  id: metaId,
  name: z.string().nullish(),
  account_review_status: z.string().nullish(),
  business_verification_status: z.string().nullish(),
  country: z.string().nullish(),
  timezone_id: z.string().nullish(),
  currency: z.string().nullish(),
  status: z.string().nullish(),
});
export type WabaResponse = z.infer<typeof wabaSchema>;

export const debugTokenSchema = z.object({
  data: z.object({
    app_id: metaId.nullish(),
    type: z.string().nullish(),
    application: z.string().nullish(),
    expires_at: z.number().nullish(),
    data_access_expires_at: z.number().nullish(),
    is_valid: z.boolean(),
    issued_at: z.number().nullish(),
    scopes: z.array(z.string()).nullish(),
    granular_scopes: z.array(z.object({ scope: z.string(), target_ids: z.array(metaId).nullish() })).nullish(),
    user_id: metaId.nullish(),
    error: z.object({ code: z.number().nullish(), message: z.string().nullish(), subcode: z.number().nullish() }).nullish(),
  }),
});
export type DebugTokenData = z.infer<typeof debugTokenSchema>["data"];

export const appSubscriptionsSchema = z.object({
  data: z.array(
    z.object({
      object: z.string(),
      callback_url: z.string().nullish(),
      active: z.boolean().nullish(),
      fields: z.array(z.object({ name: z.string(), version: z.string().nullish() })).nullish(),
    }),
  ),
});
export type AppSubscription = z.infer<typeof appSubscriptionsSchema>["data"][number];

export const subscribedAppsSchema = z.object({
  data: z.array(
    z.object({
      whatsapp_business_api_data: z.object({ id: metaId, link: z.string().nullish(), name: z.string().nullish() }).nullish(),
      override_callback_uri: z.string().nullish(),
    }),
  ),
});
export type SubscribedApp = z.infer<typeof subscribedAppsSchema>["data"][number];

// ─── Templates ([WA-22]) ────────────────────────────────────────────────────────────────────────────────

export const templateSchema = z.object({
  id: metaId,
  name: z.string().min(1).max(512),
  language: z.string().min(1).max(20),
  status: z.string().nullish(),
  category: z.string().nullish(),
  parameter_format: z.string().nullish(),
  components: z.array(z.unknown()).nullish(),
  rejected_reason: z.string().nullish(),
});
export type MetaTemplate = z.infer<typeof templateSchema>;

export const templatesPageSchema = z.object({
  data: z.array(z.unknown()),
  paging: z.object({ cursors: z.object({ before: z.string().nullish(), after: z.string().nullish() }).nullish(), next: z.string().nullish() }).nullish(),
});

// ─── Messages and media ─────────────────────────────────────────────────────────────────────────────────

export const sendMessageResponseSchema = z.object({
  contacts: z.array(z.object({ input: z.string().nullish(), wa_id: z.string().nullish(), user_id: z.string().nullish() })).nullish(),
  messages: z.array(z.object({ id: z.string().min(1).max(300), message_status: z.string().nullish() })).min(1),
});
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export const mediaInfoSchema = z.object({
  url: z.string().min(1).max(4_000),
  mime_type: z.string().nullish(),
  sha256: z.string().nullish(),
  // A string in the reference («"303833"»); a number is accepted too.
  file_size: z.union([z.string(), z.number()]).nullish(),
  id: metaId.nullish(),
});
export type MediaInfo = z.infer<typeof mediaInfoSchema>;

export const uploadMediaResponseSchema = z.object({ id: metaId });
