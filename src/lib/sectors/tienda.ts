// Tienda: the agenda of «Otro» ([ASI-04]) with its own agent template and questions.
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import { OTHER_AGENDA } from "./otro";
import type { SectorPreset } from "./schema";

export const tienda: SectorPreset = {
  slug: "tienda",
  label: "Tienda",
  description: "Tiendas y comercios: pedidos, recogidas, cambios y citas de atención personal.",
  healthData: false,
  ...OTHER_AGENDA,
  agentTemplate: {
    name: "Atención al cliente",
    description: "Resuelve dudas de productos, pedidos, envíos y devoluciones de la tienda.",
    tone: "Amable, ágil y resolutivo",
    instructions: {
      role: "Eres el asistente virtual de la tienda. Atiendes por WhatsApp, correo y el chat de la web: resuelves dudas sobre productos, pedidos, envíos, cambios y devoluciones, y das cita para recogidas o atención personal.",
      businessInfo:
        "Tienda con venta en el local y envíos. La dirección, el horario, las condiciones de envío y devolución y la información de productos están en la información del negocio y en sus documentos: usa siempre esos datos.",
      can: "Explicar las condiciones de envío, cambios y devoluciones; informar de productos que estén en los documentos; reservar, cambiar o cancelar citas de recogida o de atención personal después de confirmar el día y la hora; resolver dudas con las preguntas frecuentes.",
      cannot: `No confirmes existencias, plazos de entrega ni precios que no estén en la información del negocio. No gestiones pagos ni reembolsos por aquí. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Amable y ágil, tratando de tú. Mensajes cortos.",
      handoff:
        "Pasa la conversación a una persona si el cliente lo pide, si un pedido no ha llegado o ha llegado roto, si pide un reembolso, si hay una queja o si no sabes responder.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "reembolso", "no ha llegado", "roto"],
      sensitiveTopics: ["pedido perdido", "producto defectuoso", "cobro duplicado"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Hacéis envíos?",
      answer: "Sí, enviamos a toda la península en 24 a 72 horas laborables. También puedes recogerlo en la tienda.",
    },
    {
      question: "¿Puedo cambiar o devolver un producto?",
      answer: "Tienes 30 días para cambios y devoluciones, con el ticket y el producto en buen estado.",
    },
    {
      question: "¿Me podéis guardar un producto?",
      answer: "Sí, dinos cuál y te lo guardamos 48 horas. Si quieres, te damos cita para recogerlo ya preparado.",
    },
    {
      question: "¿Envolvéis para regalo?",
      answer: "Sí, envolvemos para regalo sin coste.",
    },
    {
      question: "¿Qué formas de pago aceptáis?",
      answer: "Efectivo, tarjeta y Bizum.",
    },
  ],
};
