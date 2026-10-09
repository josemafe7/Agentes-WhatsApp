// WhatsApp by QR code: linking a number, its panel and «Desconectar» ([QR-01]–[QR-05], [QR-10]–[QR-12]). This way is
// not the official API: nothing is created until the person accepts its risk notice, and it is refused where the app
// cannot keep a connection open ([QR-02]). The session's credentials and keys never leave the server, and the code to
// scan (a secret that links the account) is only ever shown to whoever manages channels. Changing things is «Canales:
// crear, conectar, configurar, desconectar» (owner, admin); seeing the panel, «Canales: ver».
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import type { ChannelStatus } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import type { ChannelRecord } from "@/server/channels/types";
import { hasLinkedQrSession, readWhatsAppQrConfig, whatsappQrUnsupportedReason } from "@/server/channels/whatsapp-qr/config";
import { whatsappQrHealth } from "@/server/channels/whatsapp-qr/health";
import { existingQrSupervisor, qrSupervisor, type QrSessionState } from "@/server/channels/whatsapp-qr/runtime";
import { ConflictError, parseInput, RateLimitError } from "@/server/errors";
import { QR_CODE_LARGE_SIZE, qrCodeDataUrl } from "@/server/qr";
import { assertAnswersCustomers } from "./agent-audience";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { loadWhatsAppChannel } from "./whatsapp";

const MAX_NAME = 80;
/** Links started per person: each one opens a connection to WhatsApp, and many in a row look like abuse to it ([SEG-07]). */
const LINK_LIMIT = 10;
const LINK_WINDOW_MS = 10 * 60_000;

/** A WhatsApp channel linked by QR code, or NotFoundError ([WA-54]). */
export async function loadWhatsAppQrChannel(channelId: unknown, options: { executor?: Executor } = {}): Promise<ChannelRecord> {
  return loadWhatsAppChannel(channelId, { ...options, vias: ["qr"] });
}

/** Why this installation cannot use this way, for the wizard; null where it can ([QR-02]). */
export function whatsappQrAvailability(actor: Actor): { available: boolean; reason: string | null } {
  assertCan(actor, PERMISSIONS.channels.manage);
  const reason = whatsappQrUnsupportedReason();
  return { available: reason === null, reason };
}

// ─── Linking ([QR-01]–[QR-05]) ──────────────────────────────────────────────────────────────────────────

export const startQrLinkSchema = z
  .object({
    /** Links this channel again instead of creating one ([QR-10]). */
    channelId: idSchema.optional(),
    name: z.string().trim().min(1, "Escribe el nombre.").max(MAX_NAME, `Como mucho ${MAX_NAME} caracteres.`),
    activeAgentId: idSchema.nullable().optional(),
    aiEnabled: z.boolean().default(true),
    /** The person ticked the risk notice ([QR-01]): without it nothing is created. */
    riskAccepted: z.literal(true, { error: "Marca la casilla para seguir." }),
  })
  .strict();

async function enforceLinkLimit(userId: string): Promise<void> {
  const result = await getRateLimiter().hit(`qr:link:${userId}`, LINK_LIMIT, LINK_WINDOW_MS);
  if (!result.allowed) throw new RateLimitError("Has generado muchos códigos seguidos. Espera unos minutos: a WhatsApp no le gusta que se insista.");
}

/**
 * «Generar código QR»: stores the channel (or takes the one being linked again) and opens a connection that shows a
 * code to scan. The number itself is only known once someone scans it; then the session fills it in ([QR-03]).
 */
export async function startQrLink(actor: Actor, input: unknown): Promise<{ channelId: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(startQrLinkSchema, input);
  const unsupported = whatsappQrUnsupportedReason();
  if (unsupported) throw new ConflictError(unsupported);
  await enforceLinkLimit(actor.userId);
  const existing = data.channelId ? await loadWhatsAppQrChannel(data.channelId) : null;
  const now = new Date();
  const channelId = await db.transaction(async (tx) => {
    await assertAnswersCustomers(tx, data.activeAgentId);
    const agent = data.activeAgentId === undefined ? {} : { activeAgentId: data.activeAgentId };
    if (existing) {
      // A channel that is linked and working is left as it is: there is nothing to scan.
      const status = existing.status === "connected" ? "connected" : "connecting";
      await tx
        .update(channels)
        .set({ name: data.name, aiEnabled: data.aiEnabled, ...agent, status, config: { ...existing.config, qrRiskAcceptedAt: now.toISOString() }, updatedAt: now })
        .where(eq(channels.id, existing.id));
      return existing.id;
    }
    // A number with conversations of its own starts answering nobody ([WA-56]).
    const [row] = await tx
      .insert(channels)
      .values({ type: "whatsapp", connectionMode: "qr", name: data.name, status: "connecting", config: { qrRiskAcceptedAt: now.toISOString() }, replyMode: "auto", aiEnabled: data.aiEnabled, ...agent, testMode: true, testAllowlist: [], createdAt: now, updatedAt: now })
      .returning({ id: channels.id });
    return row.id;
  });
  await writeAudit({ actor, action: "channel.qr_link_started", targetType: "channel", targetId: channelId, metadata: { type: "whatsapp", via: "qr", again: existing !== null } });
  await (await qrSupervisor()).start(channelId, { pairing: true });
  return { channelId };
}

export type QrLinkState = {
  /** «none»: this process holds no session of the channel. */
  state: QrSessionState | "none";
  /** PNG data URL of the code to scan, while there is one. */
  qr: string | null;
  /** Spanish explanation of what stopped the link, when something did. */
  error: string | null;
  status: ChannelStatus;
  /** The number, once the code was scanned. */
  number: string | null;
  accountName: string | null;
};

/** What the wizard shows while it waits ([QR-03]). The code is drawn here: its text never reaches the browser as such. */
export async function getQrLinkState(actor: Actor, channelId: string): Promise<QrLinkState> {
  // Whoever sees the code can link the account: only people who manage channels.
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWhatsAppQrChannel(channelId);
  const session = existingQrSupervisor()?.status(channel.id) ?? null;
  return {
    state: session?.state ?? "none",
    qr: session?.qr ? await qrCodeDataUrl(session.qr, QR_CODE_LARGE_SIZE) : null,
    error: session?.error ?? null,
    status: channel.status,
    number: channel.displayPhoneNumber,
    accountName: channel.verifiedName,
  };
}

// ─── Panel ([QR-11]) ────────────────────────────────────────────────────────────────────────────────────

export type WhatsAppQrPanel = {
  id: string;
  name: string;
  status: ChannelStatus;
  displayPhoneNumber: string | null;
  accountName: string | null;
  /** The session as this process sees it now; «none» when it holds none. */
  session: QrSessionState | "none";
  /** The lights, worked out now from the session. */
  health: ChannelHealth;
  linkedAt: string | null;
  lastInboundAt: Date | null;
  /** A session is stored (the number was linked and not disconnected since). */
  hasSession: boolean;
  /** Why this installation cannot keep the connection open; null where it can. */
  unsupported: string | null;
};

export async function getWhatsAppQrPanel(actor: Actor, channelId: string): Promise<WhatsAppQrPanel> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadWhatsAppQrChannel(channelId);
  const session = existingQrSupervisor()?.status(channel.id) ?? null;
  return {
    id: channel.id,
    name: channel.name,
    status: channel.status,
    displayPhoneNumber: channel.displayPhoneNumber,
    accountName: channel.verifiedName,
    session: session?.state ?? "none",
    health: whatsappQrHealth(session, { now: new Date(), lastInboundAt: channel.lastInboundAt }),
    linkedAt: readWhatsAppQrConfig(channel.config).qrLinkedAt ?? null,
    lastInboundAt: channel.lastInboundAt,
    hasSession: hasLinkedQrSession(channel),
    unsupported: whatsappQrUnsupportedReason(),
  };
}

/** «Reconectar» ([QR-11]): opens again the connection of a number that is still linked (after a cut that did not recover, or another copy of the app taking it). */
export async function reconnectWhatsAppQr(actor: Actor, channelId: string): Promise<{ state: QrSessionState | "none" }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWhatsAppQrChannel(channelId);
  const unsupported = whatsappQrUnsupportedReason();
  if (unsupported) throw new ConflictError(unsupported);
  if (channel.status === "disabled") throw new ConflictError("Este canal está desactivado: actívalo antes de reconectarlo.");
  if (!hasLinkedQrSession(channel)) throw new ConflictError("Este número no está vinculado: pulsa «Volver a vincular» y escanea un código nuevo.");
  const supervisor = await qrSupervisor();
  await supervisor.start(channel.id);
  await writeAudit({ actor, action: "channel.revalidated", targetType: "channel", targetId: channel.id, metadata: { type: "whatsapp", via: "qr" } });
  return { state: supervisor.status(channel.id)?.state ?? "none" };
}

// ─── Disconnect ([QR-12]) ───────────────────────────────────────────────────────────────────────────────

export type DisconnectWhatsAppQrResult = { warning: string | null };

/** Closes the session in WhatsApp and erases its keys; the channel keeps its history, «desactivado». */
export async function disconnectWhatsAppQr(actor: Actor, channelId: string): Promise<DisconnectWhatsAppQrResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWhatsAppQrChannel(channelId);
  const hadSession = hasLinkedQrSession(channel);
  const { loggedOut } = await (await qrSupervisor()).logout(channel.id);
  const now = new Date();
  await db.update(channels).set({ secretsEnc: null, status: "disabled", lastHealth: null, lastHealthAt: null, updatedAt: now }).where(eq(channels.id, channel.id));
  await writeAudit({ actor, action: "channel.disconnected", targetType: "channel", targetId: channel.id, metadata: { type: "whatsapp", via: "qr", loggedOut } });
  // Without an open connection WhatsApp could not be told: the device stays in the phone's list until it is removed there.
  const warning = hadSession && !loggedOut ? "No había conexión con WhatsApp para cerrar la sesión allí. Quítala tú en el móvil: WhatsApp › Dispositivos vinculados." : null;
  return { warning };
}
