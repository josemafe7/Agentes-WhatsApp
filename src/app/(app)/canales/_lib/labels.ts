// Spanish labels and options of the channel screens ([CAN-01], [CAN-07], [CAN-08], [WEB-02]). Pure data, shared by the
// list, the web chat wizard and the channel panel.
import type { ChannelStatus, OffHoursBehavior, ReplyMode } from "@/lib/enums";
import type { WebchatPosition } from "@/lib/webchat-config";

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  draft: "Borrador",
  connecting: "Conectando",
  connected: "Conectado",
  error: "Error",
  disabled: "Desactivado",
};

export const REPLY_MODE_OPTIONS: { value: ReplyMode; label: string; description: string }[] = [
  { value: "auto", label: "Automático", description: "La IA envía la respuesta al cliente." },
  { value: "draft", label: "Borrador para revisar", description: "La IA deja un borrador que una persona aprueba, edita o descarta." },
];

export const OFF_HOURS_OPTIONS: { value: OffHoursBehavior; label: string; description: string }[] = [
  { value: "reply", label: "Responder igual", description: "La IA contesta también fuera del horario del negocio." },
  { value: "no_reply", label: "No responder fuera de horario", description: "Fuera de horario, los mensajes esperan a una persona." },
];

export const POSITION_OPTIONS: { value: WebchatPosition; label: string }[] = [
  { value: "right", label: "Abajo a la derecha" },
  { value: "left", label: "Abajo a la izquierda" },
];

/** Sentinel of the «Agente activo» selector for «Sin agente» (a Select item cannot have an empty value). */
export const NO_AGENT = "none";
