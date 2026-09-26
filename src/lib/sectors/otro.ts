// Otro: a general business with appointments. Its agenda is also the one of Inmobiliaria and Tienda ([ASI-04]).
import { MON_TO_FRI, resource, serviceBuilder, weekly } from "./build";
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import type { SectorPreset } from "./schema";

const service = serviceBuilder({ minAdvanceMin: 120, maxAdvanceDays: 60 });
const MORNING: [string, string] = ["09:00", "14:00"];
const AFTERNOON: [string, string] = ["16:00", "19:00"];
const HOURS = weekly(MON_TO_FRI, MORNING, AFTERNOON);
const PEOPLE = ["profesional-1", "profesional-2"];

/** Agenda data of «Otro», reused as is by Inmobiliaria and Tienda. */
export const OTHER_AGENDA = {
  agendaMode: "individual",
  slotIntervalMin: 15,
  terminology: { booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" },
  businessHours: HOURS,
  resources: [
    resource({ key: "profesional-1", type: "person", name: "Profesional 1", color: "blue", schedule: HOURS }),
    resource({ key: "profesional-2", type: "person", name: "Profesional 2", color: "emerald", schedule: weekly(MON_TO_FRI, MORNING) }),
  ],
  services: [
    service({
      key: "cita-30",
      name: "Cita de 30 minutos",
      category: "Citas",
      durationMin: 30,
      descriptionForAgent: "Cita corta para una consulta, una gestión o una recogida.",
      resourceKeys: PEOPLE,
    }),
    service({
      key: "cita-60",
      name: "Cita de 1 hora",
      category: "Citas",
      durationMin: 60,
      descriptionForAgent: "Cita larga para una reunión, una visita o una atención más detallada.",
      resourceKeys: PEOPLE,
    }),
  ],
} satisfies Pick<
  SectorPreset,
  "agendaMode" | "slotIntervalMin" | "terminology" | "businessHours" | "resources" | "services"
>;

export const otro: SectorPreset = {
  slug: "otro",
  label: "Otro",
  description: "Cualquier otro negocio que atiende a sus clientes con cita.",
  healthData: false,
  ...OTHER_AGENDA,
  agentTemplate: {
    name: "Asistente del negocio",
    description: "Atiende dudas y gestiona las citas del negocio.",
    tone: "Amable y profesional",
    instructions: {
      role: "Eres el asistente virtual del negocio. Atiendes a los clientes por WhatsApp, correo y el chat de la web: resuelves sus dudas y gestionas sus citas.",
      businessInfo:
        "Los datos del negocio (qué hace, dirección, horario, servicios y precios orientativos) están en la información del negocio y en sus documentos: usa siempre esos datos.",
      can: "Explicar los servicios; buscar huecos y reservar, cambiar o cancelar citas después de confirmar el día, la hora y el servicio; resolver dudas con las preguntas frecuentes y los documentos.",
      cannot: `No hables de temas que no tengan que ver con el negocio: redirige la conversación con amabilidad. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Amable, profesional y breve, tratando de tú.",
      handoff: "Pasa la conversación a una persona si el cliente lo pide, si hay una queja o si no sabes responder después de intentarlo.",
    },
    handoff: {
      keywords: COMMON_HANDOFF_KEYWORDS,
      sensitiveTopics: [],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Cómo pido una cita?",
      answer: "Escríbenos por aquí qué necesitas y qué días te vienen bien, y te proponemos un hueco.",
    },
    {
      question: "¿Puedo cambiar o cancelar mi cita?",
      answer: "Sí, avísanos por aquí con 24 horas de antelación.",
    },
    {
      question: "¿Puedo hablar con una persona?",
      answer: "Claro. Dilo en cualquier momento y te pasamos con alguien del equipo.",
    },
    {
      question: "¿Qué formas de pago aceptáis?",
      answer: "Efectivo, tarjeta y transferencia.",
    },
  ],
};
