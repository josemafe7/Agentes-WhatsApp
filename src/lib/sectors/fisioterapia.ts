// Clínica/Fisioterapia: agenda by individual professional; health data ([AGD-06], [ASI-05]).
import { MON, MON_TO_FRI, resource, serviceBuilder, THU, TUE, WED, weekly } from "./build";
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import type { SectorPreset } from "./schema";

const service = serviceBuilder({ minAdvanceMin: 120, maxAdvanceDays: 60 });
const MORNING: [string, string] = ["08:00", "14:00"];
const AFTERNOON: [string, string] = ["15:30", "21:00"];
const PHYSIOS = ["fisio-1", "fisio-2"];
/** Time to air the room and change the stretcher cover between patients. */
const TURNOVER_MIN = 10;

export const fisioterapia: SectorPreset = {
  slug: "fisioterapia",
  label: "Clínica/Fisioterapia",
  description: "Clínicas de fisioterapia y consultas con sesiones por profesional.",
  healthData: true,
  agendaMode: "individual",
  slotIntervalMin: 15,
  terminology: { booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "paciente" },
  businessHours: weekly(MON_TO_FRI, MORNING, AFTERNOON),
  resources: [
    resource({
      key: "fisio-1",
      type: "person",
      name: "Fisioterapeuta 1",
      color: "emerald",
      schedule: [...weekly(MON_TO_FRI, MORNING), ...weekly([MON, WED], AFTERNOON)],
    }),
    resource({
      key: "fisio-2",
      type: "person",
      name: "Fisioterapeuta 2",
      color: "orange",
      schedule: [...weekly(MON_TO_FRI, AFTERNOON), ...weekly([TUE, THU], MORNING)],
    }),
  ],
  services: [
    service({
      key: "primera-valoracion",
      name: "Primera valoración",
      category: "Valoración",
      durationMin: 60,
      bufferAfterMin: TURNOVER_MIN,
      descriptionForAgent:
        "Entrevista, exploración y primer tratamiento. Es la cita para quien viene por primera vez o por una lesión nueva.",
      resourceKeys: PHYSIOS,
    }),
    service({
      key: "sesion-fisioterapia",
      name: "Sesión de fisioterapia",
      category: "Tratamiento",
      durationMin: 45,
      bufferAfterMin: TURNOVER_MIN,
      descriptionForAgent: "Sesión de seguimiento para pacientes que ya han hecho la primera valoración.",
      resourceKeys: PHYSIOS,
    }),
    service({
      key: "masaje-descontracturante",
      name: "Masaje descontracturante",
      category: "Tratamiento",
      durationMin: 60,
      bufferAfterMin: TURNOVER_MIN,
      descriptionForAgent: "Masaje para contracturas y sobrecargas musculares (espalda, cuello, piernas).",
      resourceKeys: PHYSIOS,
    }),
    service({
      key: "puncion-seca",
      name: "Punción seca",
      category: "Tratamiento",
      durationMin: 30,
      bufferAfterMin: TURNOVER_MIN,
      descriptionForAgent: "Técnica para puntos gatillo miofasciales. Solo para pacientes valorados antes por el fisioterapeuta.",
      resourceKeys: ["fisio-1"],
    }),
    service({
      key: "fisioterapia-deportiva",
      name: "Fisioterapia deportiva",
      category: "Deporte",
      durationMin: 60,
      bufferAfterMin: TURNOVER_MIN,
      descriptionForAgent: "Lesiones deportivas, readaptación y prevención para corredores y deportistas.",
      resourceKeys: ["fisio-2"],
    }),
  ],
  agentTemplate: {
    name: "Recepción de fisioterapia",
    description: "Atiende a los pacientes y gestiona las citas de la clínica de fisioterapia.",
    tone: "Profesional, cercano y tranquilizador",
    instructions: {
      role: "Eres el asistente virtual de recepción de la clínica de fisioterapia. Atiendes a los pacientes por WhatsApp, correo y el chat de la web: resuelves dudas y gestionas sus citas.",
      businessInfo:
        "Clínica de fisioterapia: valoraciones, sesiones de tratamiento, masaje, punción seca y fisioterapia deportiva. La dirección, el horario, los servicios y sus precios orientativos están en la información del negocio: usa siempre esos datos.",
      can: "Explicar los servicios y cuál encaja para una primera vez; buscar huecos y reservar, cambiar o cancelar citas después de confirmar con el paciente el día, la hora y el servicio; resolver dudas con las preguntas frecuentes.",
      cannot: `No diagnostiques lesiones, no recomiendes ejercicios ni medicamentos y no digas cuántas sesiones necesitará nadie: eso lo decide el fisioterapeuta. No pidas datos de salud más allá del motivo de la cita. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Profesional y cercano, tratando de tú. Frases claras y cortas.",
      handoff:
        "Pasa la conversación a una persona si el paciente lo pide, si describe un dolor muy intenso, una lesión reciente con hinchazón fuerte o síntomas que no sean musculares, si pregunta por mutuas o bonos concretos, si hay una queja o si no sabes responder.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "mutua", "bono"],
      sensitiveTopics: ["dolor muy intenso", "hormigueo o pérdida de fuerza", "lesión reciente con hinchazón"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Necesito un informe médico para ir?",
      answer: "No hace falta. Si tienes informes o pruebas (resonancia, radiografías), tráelos a la primera valoración.",
    },
    {
      question: "¿Qué ropa tengo que llevar?",
      answer: "Ropa cómoda que te deje moverte y dejar al descubierto la zona que vamos a tratar.",
    },
    {
      question: "¿Cuántas sesiones voy a necesitar?",
      answer: "Depende de cada caso. En la primera valoración el fisioterapeuta te explica el plan y cuántas sesiones calcula.",
    },
    {
      question: "¿Trabajáis con mutuas?",
      answer: "Trabajamos con algunas mutuas. Dinos cuál tienes y el equipo lo comprueba.",
    },
    {
      question: "¿Tenéis bonos de sesiones?",
      answer: "Sí, tenemos bonos de varias sesiones. El equipo te informa de las opciones en la primera valoración.",
    },
    {
      question: "¿Puedo cambiar o anular mi cita?",
      answer: "Sí, avísanos por aquí con 24 horas de antelación y te buscamos otro hueco.",
    },
  ],
};
