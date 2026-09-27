// Spanish names of the notification events ([AJU-08]); the list itself lives in src/data/notification-settings.ts.
import type { NotificationEvent } from "@/data/notification-settings";

export const EVENT_LABELS: Record<NotificationEvent, { label: string; description: string }> = {
  handoff: {
    label: "Traspaso a una persona",
    description: "Una conversación pasa de la IA a una persona. Los agentes solo reciben los de sus canales.",
  },
  new_conversation: {
    label: "Conversación nueva",
    description: "Un cliente escribe por primera vez o vuelve a escribir en una conversación cerrada.",
  },
  conversation_assigned: {
    label: "Conversación asignada",
    description: "Avisa solo a la persona a la que se asigna.",
  },
  channel_error: {
    label: "Canal con error",
    description: "Un canal deja de recibir o de enviar mensajes, o pide que lo vuelvas a conectar.",
  },
  whatsapp_quality: {
    label: "Calidad de WhatsApp",
    description: "Meta baja la calidad o el límite de mensajes de un número.",
  },
  model_deprecated: {
    label: "Modelo de IA que se retira",
    description: "Un agente usa un modelo que OpenRouter va a retirar.",
  },
  booking_pending: {
    label: "Cita pendiente de confirmar",
    description: "Se pide una cita de un servicio que requiere confirmación manual. Los agentes solo reciben las de sus canales.",
  },
};
