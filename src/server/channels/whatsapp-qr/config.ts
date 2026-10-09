// What a WhatsApp number linked by QR code stores ([QR-04], [CAN-17], [SEG-01], docs/modelo-de-datos.md «Canales ·
// WhatsApp por código QR»): the linked device's own credentials, encrypted in `channels.secrets_enc` as { creds }; the
// session keys, one encrypted row each, in `whatsapp_qr_keys`; the number in the channel's WhatsApp columns
// (`connection_mode` «qr») and what is this way's own in `channels.config`. Server only, and without the library: the
// screens and the data layer read this file.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels } from "@/db/schema";
import { phoneDigits } from "@/lib/meta/markets";
import { AppError } from "@/server/errors";
import { encryptChannelSecrets, readChannelSecrets } from "../secrets";
import type { ChannelRecord } from "../types";

const storedSecretsSchema = z.object({ creds: z.string().min(1) });

/** The linked device's credentials as the library serializes them (JSON text), or null (none, or unreadable after a key change). */
export function readQrCredsText(channel: Pick<ChannelRecord, "secretsEnc">): string | null {
  return readChannelSecrets(channel, storedSecretsSchema)?.creds ?? null;
}

/**
 * Whether the stored session is of a device WhatsApp already accepted (its code was scanned): the credentials name the
 * account. Read without the library, so the screens can ask. Credentials of a code nobody scanned are not a session.
 */
export function hasLinkedQrSession(channel: Pick<ChannelRecord, "secretsEnc">): boolean {
  const text = readQrCredsText(channel);
  if (!text) return false;
  try {
    const creds = JSON.parse(text) as { me?: { id?: unknown } } | null;
    return typeof creds?.me?.id === "string" && creds.me.id.length > 0;
  } catch {
    return false;
  }
}

/** `secrets_enc` for these credentials. */
export function encryptQrCreds(credsText: string): string {
  return encryptChannelSecrets({ creds: credsText });
}

/** Non-secret settings of a QR channel in `channels.config` (other keys there are kept as they are). */
export const whatsappQrConfigSchema = z.object({
  /** When the number was linked: nothing older is ever read as a new message ([QR-06]). ISO time. */
  qrLinkedAt: z.string().max(40).nullish().catch(null),
  /** The person accepted the risk notice of this way, and when ([QR-01]). ISO time. */
  qrRiskAcceptedAt: z.string().max(40).nullish().catch(null),
  /** If the AI's reply cannot be sent, the conversation goes to a person (read by the reply engine). */
  handoffOnSendFailure: z.boolean().catch(false).default(false),
});
export type WhatsAppQrConfig = z.infer<typeof whatsappQrConfigSchema>;

export function readWhatsAppQrConfig(config: Record<string, unknown> | null | undefined): WhatsAppQrConfig {
  const parsed = whatsappQrConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : whatsappQrConfigSchema.parse({});
}

type ChannelColumns = Partial<Omit<typeof channels.$inferInsert, "id" | "config">>;

/** Merges `patch` into the channel's stored config (read and written in one transaction), plus other columns. */
export async function updateWhatsAppQrChannel(channelId: string, patch: Partial<WhatsAppQrConfig>, extra: ChannelColumns = {}, executor?: Executor): Promise<void> {
  const run = async (tx: Executor) => {
    const [row] = await tx.select({ config: channels.config }).from(channels).where(eq(channels.id, channelId));
    if (!row) return;
    const config = { ...row.config, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
    await tx.update(channels).set({ ...extra, config, updatedAt: new Date() }).where(eq(channels.id, channelId));
  };
  await (executor ? run(executor) : db.transaction(run));
}

/**
 * What goes in the channel's `phone_number_id`, which is unique in the installation ([WA-11], [QR-05]): never the id
 * Meta gives a number (only digits), so no webhook of Meta can take this channel for one of its own.
 */
export const qrPhoneNumberId = (phoneNumber: string) => `qr:${phoneDigits(phoneNumber)}`;

/** «+34 600 111 222» is not known here: the number as its digits with «+». */
export const qrDisplayNumber = (digits: string) => `+${digits}`;

/** The session of this number is not open in this process: nothing can be sent ([QR-02], [QR-10]). */
export class WhatsAppQrNotConnectedError extends AppError {
  constructor() {
    super(409, "whatsapp_qr_not_connected", "La sesión de WhatsApp de este número no está abierta. Mira su panel: puede que haya que volver a vincularlo.");
  }
}

/** Why this installation cannot keep a linked session, in Spanish; null where it can ([QR-02]). */
export function whatsappQrUnsupportedReason(env: NodeJS.ProcessEnv = process.env): string | null {
  // A Vercel function lives for one request: nothing there can keep WhatsApp's connection open.
  if (env.VERCEL) {
    return "Esta vía necesita que la app esté siempre encendida, y en Vercel cada petición arranca y se apaga. Funciona en tu ordenador (pnpm dev) y en un servidor propio; aquí usa la API oficial de Meta o YCloud.";
  }
  return null;
}
