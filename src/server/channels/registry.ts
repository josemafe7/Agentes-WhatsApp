// Adapters by channel type. Each channel phase registers its adapter at import time (WhatsApp in phase 3, email in
// phase 6…); demo channels always use the DemoAdapter, which never calls a real service ([ARR-11]).
import "server-only";
import type { ChannelType } from "@/lib/enums";
import { AppError } from "@/server/errors";
import { defaultCapabilitiesOf } from "./capabilities";
import { demoAdapter } from "./demo-adapter";
import { gmailAdapter, imapAdapter, outlookAdapter } from "./email/adapter";
import type { ChannelAdapter, ChannelCapabilities, ChannelRecord } from "./types";
import { webchatAdapter } from "./webchat-adapter";
import { whatsappAdapter } from "./whatsapp/adapter";

export class ChannelAdapterMissingError extends AppError {
  constructor() {
    super(503, "channel_adapter_missing", "Este tipo de canal todavía no está disponible en esta instalación.");
  }
}

// One registry per copy of this module, never on globalThis: a production build carries its own copy of the server code
// in each route's bundle (the WhatsApp webhook, the cron, each page and its actions). A process-wide registry handed
// one bundle's adapter to another, whose `instanceof ChannelSendError` then failed: a Meta error such as 131047 showed
// as «error inesperado». Every adapter is registered below, so a hot reload registers them again.
const registry = new Map<ChannelType, ChannelAdapter>();

/** Registers the adapter of a channel type; registering again replaces it (tests, hot reload). */
export function registerChannelAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.type, adapter);
}

/** Tests only. */
export function unregisterChannelAdapter(type: ChannelType): void {
  registry.delete(type);
}

registerChannelAdapter(webchatAdapter);
registerChannelAdapter(whatsappAdapter);
registerChannelAdapter(gmailAdapter);
registerChannelAdapter(outlookAdapter);
registerChannelAdapter(imapAdapter);

/** The adapter that talks to this channel. Demo WhatsApp and email channels get the DemoAdapter. */
export function getChannelAdapter(channel: Pick<ChannelRecord, "type" | "isDemo">): ChannelAdapter {
  if (channel.isDemo && channel.type !== "webchat") return demoAdapter;
  const adapter = registry.get(channel.type);
  if (!adapter) throw new ChannelAdapterMissingError();
  return adapter;
}

/**
 * The adapter for sending. Replies to simulated messages never leave the app, even on a real channel ([AJU-13]):
 * they go through the DemoAdapter, which only stores them (the web chat adapter only stores anyway).
 */
export function getSendAdapter(channel: Pick<ChannelRecord, "type" | "isDemo">, simulated: boolean): ChannelAdapter {
  if (simulated && channel.type !== "webchat") return demoAdapter;
  return getChannelAdapter(channel);
}

/** What the channel can do: from its adapter, or the type's defaults while its adapter is not installed yet. */
export function capabilitiesOf(channel: ChannelRecord): ChannelCapabilities {
  try {
    return getChannelAdapter(channel).capabilities(channel);
  } catch (error) {
    if (error instanceof ChannelAdapterMissingError) return defaultCapabilitiesOf(channel);
    throw error;
  }
}
