// How the inbox shows states (DESIGN.md «Estados de conversación y modo de IA», «Estados de entrega»): Spanish text,
// icon and colour token together, never colour alone. Pure, for the list and the conversation.
import { tz } from "@date-fns/tz";
import { differenceInCalendarDays } from "date-fns";
import {
  Bot,
  Check,
  CheckCheck,
  CircleCheck,
  CircleDot,
  CirclePause,
  CirclePlay,
  CircleX,
  Clock,
  Hand,
  Headset,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import type { ConversationStatus, HandoffTrigger, MessageContentType, MessageStatus, Urgency } from "@/lib/enums";
import { DEFAULT_TIMEZONE, formatDateTime, formatNumber, isValidTimeZone } from "@/lib/format";

export type StateMeta = { label: string; icon: LucideIcon; className: string };

/** Text colour and soft background of a status pill. */
export const STATUS_META: Record<ConversationStatus, StateMeta & { pill: string }> = {
  open: { label: "Abierta", icon: CircleDot, className: "text-info", pill: "bg-info-soft text-info" },
  pending_human: { label: "Pendiente de humano", icon: Hand, className: "text-warning", pill: "bg-warning-soft text-warning" },
  resolved: { label: "Resuelta", icon: CircleCheck, className: "text-success", pill: "bg-success-soft text-success" },
};

/** Delivery state of a message of the business; «received» (the customer's) shows nothing. */
export const DELIVERY_META: Record<Exclude<MessageStatus, "received">, StateMeta> = {
  queued: { label: "En cola", icon: Clock, className: "text-muted-foreground" },
  sent: { label: "Enviado", icon: Check, className: "text-muted-foreground" },
  delivered: { label: "Entregado", icon: CheckCheck, className: "text-muted-foreground" },
  read: { label: "Leído", icon: CheckCheck, className: "text-info" },
  played: { label: "Reproducido", icon: CirclePlay, className: "text-info" },
  failed: { label: "No enviado", icon: CircleX, className: "text-destructive-text" },
  draft: { label: "Borrador", icon: Pencil, className: "text-warning" },
};

export type AiState = { kind: "ai" } | { kind: "paused"; until: Date } | { kind: "human" };

/** The AI answers, is paused until a time, or a person has the conversation (AI off or handed off). */
export function aiStateOf(conversation: { aiMode: "ai" | "human"; aiPausedUntil: Date | null }, now: Date): AiState {
  if (conversation.aiMode === "human") return { kind: "human" };
  if (conversation.aiPausedUntil && conversation.aiPausedUntil > now) return { kind: "paused", until: conversation.aiPausedUntil };
  return { kind: "ai" };
}

export const AI_STATE_META: Record<AiState["kind"], StateMeta> = {
  ai: { label: "IA", icon: Bot, className: "text-ai" },
  paused: { label: "IA en pausa", icon: CirclePause, className: "text-muted-foreground" },
  human: { label: "Persona", icon: Headset, className: "text-muted-foreground" },
};

/** «18:40» today, «mañana a las 06:40», or «el 12 oct a las 10:00», in the business time zone. */
export function formatUntil(date: Date, timezone: string, now: Date): string {
  const zone = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const days = differenceInCalendarDays(date, now, { in: tz(zone) });
  const time = formatDateTime(date, zone, { preset: "time" });
  if (days === 0) return time;
  if (days === 1) return `mañana a las ${time}`;
  return `el ${formatDateTime(date, zone, { pattern: "d MMM" })} a las ${time}`;
}

/** What is left of the WhatsApp 24 h window: «3 h 12 min», «45 min». */
export function windowRemaining(closesAt: Date, now: Date): string {
  const minutes = Math.floor((closesAt.getTime() - now.getTime()) / 60_000);
  if (minutes < 1) return "menos de 1 min";
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

const KB = 1024;
const MB = KB * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${formatNumber(Math.round(bytes / KB))} kB`;
  return `${formatNumber(bytes / MB, { maximumFractionDigits: 1 })} MB`;
}

export const UNNAMED_CONTACT = "Cliente sin nombre";

export function contactDisplayName(name: string | null | undefined): string {
  return name?.trim() || UNNAMED_CONTACT;
}

/** What a message without text is, in the list and in the bubble. */
export const CONTENT_TYPE_LABELS: Record<MessageContentType, string> = {
  text: "Mensaje",
  image: "Imagen",
  audio: "Audio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto compartido",
  interactive: "Respuesta a botones",
  template: "Plantilla",
  unsupported: "Mensaje que este canal no permite mostrar",
  system: "Aviso del sistema",
};

export const URGENCY_LABELS: Record<Urgency, string> = { low: "Baja", normal: "Normal", high: "Alta" };

export const HANDOFF_TRIGGER_LABELS: Record<HandoffTrigger, string> = {
  ai_tool: "La IA lo ha pedido",
  rule: "Regla del agente",
  human: "Una persona, a mano",
};

/** Hand-offs the platform makes on its own (src/server/engine/reply.ts): not a rule of the agent. */
const PLATFORM_HANDOFF_LABELS: Record<string, string> = {
  ai_failure: "La IA ha fallado",
  send_failed: "No se pudo enviar la respuesta",
};

/** Who or what handed the conversation over ([TRA-01], [TRA-07]). */
export function handoffSourceLabel(handoff: { trigger: HandoffTrigger; rule: string | null }): string {
  return (handoff.trigger === "rule" && handoff.rule ? PLATFORM_HANDOFF_LABELS[handoff.rule] : undefined) ?? HANDOFF_TRIGGER_LABELS[handoff.trigger];
}
