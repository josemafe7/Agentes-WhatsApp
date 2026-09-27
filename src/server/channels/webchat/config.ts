// What the widget may know about its channel ([WEB-02], [WEB-13], [SEG-02]): look, texts and switches, never
// secrets, allowed domains, agents or test lists. System reads: the web chat is public by design ([PER-09]).
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getPublicBusinessInfo, LOGO_KEY_PREFIX } from "@/data/business";
import { WEBCHAT_LOGO_KEY_PREFIX } from "@/data/webchat-logo";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { primaryCssVars } from "@/lib/color";
import { idSchema } from "@/lib/validation";
import { readWebchatConfig, type WebchatPosition } from "@/lib/webchat-config";
import { aiDisclosureText } from "@/server/engine/disclosure";
import type { ChannelRecord } from "../types";
import { WEBCHAT_MAX_TEXT } from "../webchat-adapter";
import { WIDGET_MAX_UPLOAD_BYTES } from "./upload";

export const DEFAULT_WELCOME_MESSAGE = "¡Hola! ¿En qué podemos ayudarte?";
export const PRIVACY_PATH = "/legal/privacidad";

/** The web chat channel with this id, or null (bad id, missing, or another channel type). */
export async function loadWidgetChannel(channelId: unknown): Promise<ChannelRecord | null> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) return null;
  const [row] = await db.select().from(channels).where(and(eq(channels.id, id.data), eq(channels.type, "webchat")));
  return row ?? null;
}

/** A disabled channel keeps its history but the chat says it is not available ([WEB-13], [CAN-16]). */
export function isChannelAvailable(channel: Pick<ChannelRecord, "status">): boolean {
  return channel.status !== "disabled";
}

/** Paths are relative to the app: the widget prefixes the address it was loaded from. */
export type WidgetPublicConfig = {
  channelId: string;
  available: boolean;
  businessName: string;
  /**
   * The channel colour (or the business one) adjusted for contrast like the app's --primary (DESIGN.md): the
   * visitor's bubbles and buttons, the text on them, and links on white.
   */
  color: { background: string; foreground: string; text: string };
  logoUrl: string | null;
  welcomeMessage: string;
  position: WebchatPosition;
  legalText: string | null;
  privacyUrl: string;
  /** An agent answers here; otherwise only people do. */
  aiActive: boolean;
  /** The AI notice ([CUM-01]): the channel's, the business's or the default. */
  aiNotice: string;
  imagesEnabled: boolean;
  voiceEnabled: boolean;
  maxTextLength: number;
  maxUploadBytes: number;
};

/** Folders that only ever hold logos: the business's (logos/) and the web chats' own (webchat-logos/). */
const LOGO_PREFIXES = [`${LOGO_KEY_PREFIX}/`, `${WEBCHAT_LOGO_KEY_PREFIX}/`];

/**
 * The chat's own logo (uploaded from Canales, src/data/webchat-logo.ts), else the business logo. Only keys under the
 * logo folders qualify, so the chat settings can never turn a private file into a public one ([MED-08]).
 */
function logoKeyOf(chatLogoKey: string | null, businessLogoKey: string | null): string | null {
  const isLogo = (key: string | null): key is string => LOGO_PREFIXES.some((prefix) => key?.startsWith(prefix) === true);
  if (isLogo(chatLogoKey)) return chatLogoKey;
  return businessLogoKey?.startsWith(`${LOGO_KEY_PREFIX}/`) ? businessLogoKey : null;
}

export async function widgetLogoKey(channel: Pick<ChannelRecord, "config">): Promise<string | null> {
  return logoKeyOf(readWebchatConfig(channel.config).logoFileKey, (await getPublicBusinessInfo()).logoFileKey);
}

/** The logo URL changes with the file, so browsers may cache each version for good. */
function logoUrl(channelId: string, key: string): string {
  const version = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `/api/widget/${channelId}/logo?v=${version}`;
}

export async function widgetPublicConfig(channel: ChannelRecord): Promise<WidgetPublicConfig> {
  const config = readWebchatConfig(channel.config);
  const business = await getPublicBusinessInfo();
  const colors = primaryCssVars(config.color ?? business.color).light;
  const logoKey = logoKeyOf(config.logoFileKey, business.logoFileKey);
  return {
    channelId: channel.id,
    available: isChannelAvailable(channel),
    businessName: business.name.trim() || channel.name,
    color: { background: colors["--primary"], foreground: colors["--primary-foreground"], text: colors["--primary-text"] },
    logoUrl: logoKey ? logoUrl(channel.id, logoKey) : null,
    welcomeMessage: config.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE,
    position: config.position,
    legalText: config.legalText,
    privacyUrl: PRIVACY_PATH,
    aiActive: channel.aiEnabled && channel.activeAgentId !== null,
    aiNotice: await aiDisclosureText(channel.disclosureMessage),
    imagesEnabled: config.imagesEnabled,
    voiceEnabled: config.voiceEnabled,
    maxTextLength: WEBCHAT_MAX_TEXT,
    maxUploadBytes: WIDGET_MAX_UPLOAD_BYTES,
  };
}

export type WidgetDemoChannel = { id: string; name: string; available: boolean };

/** Web chats to try on /widget-demo ([WEB-12]): names only, like the code pasted on any site. */
export async function listWidgetDemoChannels(): Promise<WidgetDemoChannel[]> {
  const rows = await db
    .select({ id: channels.id, name: channels.name, status: channels.status })
    .from(channels)
    .where(eq(channels.type, "webchat"))
    .orderBy(asc(channels.name));
  return rows.map((row) => ({ id: row.id, name: row.name, available: isChannelAvailable(row) }));
}
