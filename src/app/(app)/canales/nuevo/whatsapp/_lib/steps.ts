// Steps of the WhatsApp wizard (docs/pantallas.md «Asistente de WhatsApp»). Aviso and Datos happen before the channel
// exists; from Webhook on, the address carries the channel and the step (?canal=…&paso=…), so the person can leave and
// come back («Continuar configuración», DESIGN.md › Asistentes). Pure: shared by the page and the client steps.
import type { ChannelStatus } from "@/lib/enums";

export const WA_WIZARD_PATH = "/canales/nuevo/whatsapp";

export const WIZARD_STEPS = [
  { id: "aviso", label: "Aviso" },
  { id: "datos", label: "Datos" },
  { id: "webhook", label: "Webhook" },
  { id: "activar", label: "Activar" },
  { id: "prueba", label: "Prueba" },
  { id: "agente", label: "Agente" },
] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

/** The steps of a channel that already exists: the ones the address may ask for. */
export const CHANNEL_STEPS = ["webhook", "activar", "prueba", "agente"] as const;
export type ChannelStep = (typeof CHANNEL_STEPS)[number];

/** `paso` of the address, or null when it is not a channel step. */
export function parseChannelStep(value: unknown): ChannelStep | null {
  return CHANNEL_STEPS.find((step) => step === value) ?? null;
}

export function nextChannelStep(step: ChannelStep): ChannelStep | null {
  return CHANNEL_STEPS[CHANNEL_STEPS.indexOf(step) + 1] ?? null;
}

export function previousChannelStep(step: ChannelStep): ChannelStep | null {
  const index = CHANNEL_STEPS.indexOf(step);
  return index > 0 ? CHANNEL_STEPS[index - 1] : null;
}

/**
 * Where a number is resumed: without credentials (disconnected) its data again; until the app is subscribed to its
 * WABA and the channel is «conectado», the webhook; then the activation.
 */
export function resumeStep(channel: { hasCredentials: boolean; status: ChannelStatus; webhookStatus: string | null }): "datos" | ChannelStep {
  if (!channel.hasCredentials) return "datos";
  if (channel.webhookStatus !== "subscribed" || (channel.status !== "connected" && channel.status !== "error")) return "webhook";
  return "activar";
}

/** Address of a step of a channel (without step: where it was left). */
export function wizardHref(channelId: string, step?: ChannelStep): string {
  const query = new URLSearchParams({ canal: channelId, ...(step ? { paso: step } : {}) });
  return `${WA_WIZARD_PATH}?${query.toString()}`;
}
