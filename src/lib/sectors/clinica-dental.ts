// Clínica dental: agenda by individual professional; health data ([AGD-06], [ASI-05]).
import { FRI, MON, resource, serviceBuilder, THU, TUE, WED, weekly } from "./build";
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import type { SectorPreset } from "./schema";

const service = serviceBuilder({ minAdvanceMin: 120, maxAdvanceDays: 90 });
const MORNING: [string, string] = ["09:00", "14:00"];
const AFTERNOON: [string, string] = ["16:00", "20:30"];
const FRIDAY: [string, string] = ["09:00", "15:00"];
const DENTISTS = ["dentista-1", "dentista-2"];
/** Time to clean and prepare the surgery after each patient. */
const CLEANING_MIN = 10;

export const clinicaDental: SectorPreset = {
  slug: "clinica-dental",
  label: "Clínica dental",
  description: "Clínicas dentales con citas por odontólogo o higienista.",
  healthData: true,
  agendaMode: "individual",
  slotIntervalMin: 15,
  terminology: { booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "paciente" },
  businessHours: [...weekly([MON, TUE, WED, THU], MORNING, AFTERNOON), ...weekly([FRI], FRIDAY)],
  resources: [
    resource({
      key: "dentista-1",
      type: "person",
      name: "Odontólogo/a 1",
      color: "teal",
      schedule: [...weekly([MON, TUE, WED, THU], MORNING, AFTERNOON), ...weekly([FRI], FRIDAY)],
    }),
    resource({
      key: "dentista-2",
      type: "person",
      name: "Odontólogo/a 2",
      color: "blue",
      schedule: [...weekly([MON, WED, THU], AFTERNOON), ...weekly([TUE], MORNING), ...weekly([FRI], FRIDAY)],
    }),
    resource({
      key: "higienista",
      type: "person",
      name: "Higienista",
      color: "emerald",
      schedule: [...weekly([MON, TUE, WED, THU], MORNING), ...weekly([TUE, THU], AFTERNOON), ...weekly([FRI], FRIDAY)],
    }),
  ],
  services: [
    service({
      key: "primera-visita",
      name: "Primera visita y revisión",
      category: "Diagnóstico",
      durationMin: 30,
      bufferAfterMin: CLEANING_MIN,
      descriptionForAgent: "Exploración completa y, si hace falta, radiografía. Al terminar se explica el plan de tratamiento.",
      resourceKeys: DENTISTS,
    }),
    service({
      key: "limpieza",
      name: "Limpieza dental",
      category: "Higiene",
      durationMin: 45,
      bufferAfterMin: CLEANING_MIN,
      descriptionForAgent: "Limpieza con ultrasonidos y pulido. Se recomienda una o dos veces al año.",
      resourceKeys: ["higienista"],
    }),
    service({
      key: "empaste",
      name: "Empaste",
      category: "Tratamientos",
      durationMin: 45,
      bufferAfterMin: CLEANING_MIN,
      descriptionForAgent: "Obturación de una caries ya diagnosticada. Si el paciente no sabe qué necesita, ofrece primera visita.",
      resourceKeys: DENTISTS,
    }),
    service({
      key: "endodoncia",
      name: "Endodoncia",
      category: "Tratamientos",
      durationMin: 90,
      bufferAfterMin: CLEANING_MIN,
      requiresManualConfirmation: true,
      descriptionForAgent:
        "Tratamiento de conducto indicado antes por el odontólogo. La cita la confirma el equipo: díselo al paciente.",
      resourceKeys: ["dentista-1"],
    }),
    service({
      key: "blanqueamiento",
      name: "Blanqueamiento",
      category: "Estética dental",
      durationMin: 60,
      bufferAfterMin: CLEANING_MIN,
      requiresManualConfirmation: true,
      descriptionForAgent: "Blanqueamiento en consulta. Requiere una revisión previa; la cita la confirma el equipo.",
      resourceKeys: ["dentista-2"],
    }),
    service({
      key: "revision-ortodoncia",
      name: "Revisión de ortodoncia",
      category: "Ortodoncia",
      durationMin: 20,
      bufferAfterMin: CLEANING_MIN,
      descriptionForAgent: "Control y ajuste de brackets o alineadores de pacientes que ya están en tratamiento.",
      resourceKeys: ["dentista-2"],
    }),
    service({
      key: "urgencia",
      name: "Urgencia dental",
      category: "Urgencias",
      durationMin: 30,
      bufferAfterMin: CLEANING_MIN,
      minAdvanceMin: 0,
      maxAdvanceDays: 2,
      descriptionForAgent:
        "Dolor fuerte, inflamación, un diente roto o un golpe. Ofrece el primer hueco libre. Si hay fiebre alta o la inflamación dificulta respirar o tragar, pasa con una persona.",
      resourceKeys: DENTISTS,
    }),
  ],
  agentTemplate: {
    name: "Recepción de la clínica",
    description: "Atiende a los pacientes y gestiona las citas de la clínica dental.",
    tone: "Profesional, amable y tranquilizador",
    instructions: {
      role: "Eres el asistente virtual de recepción de la clínica dental. Atiendes a los pacientes por WhatsApp, correo y el chat de la web: resuelves dudas sobre la clínica y gestionas sus citas.",
      businessInfo:
        "Clínica dental con odontología general, higiene, ortodoncia, estética dental y urgencias. La dirección, el horario, los tratamientos y sus precios orientativos están en la información del negocio: usa siempre esos datos.",
      can: "Explicar en qué consiste cada tratamiento de forma general; buscar huecos y reservar, cambiar o cancelar citas después de confirmar con el paciente el día, la hora y el tratamiento; dar prioridad a las urgencias; resolver dudas con las preguntas frecuentes.",
      cannot: `No diagnostiques, no recomiendes medicamentos ni digas qué tratamiento necesita alguien: eso lo decide el odontólogo en consulta. No pidas ni comentes datos de salud más allá del motivo de la cita. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Profesional, amable y tranquilizador, tratando de tú salvo que el paciente prefiera el usted. Frases claras y cortas.",
      handoff:
        "Pasa la conversación a una persona si el paciente lo pide, si describe un dolor muy fuerte, fiebre o una inflamación que empeora, si pregunta por un presupuesto o la financiación de un tratamiento, si hay una queja o si no sabes responder.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "presupuesto", "financiación"],
      sensitiveTopics: ["dolor muy fuerte", "fiebre", "inflamación que empeora", "resultado de un tratamiento"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Atendéis urgencias?",
      answer:
        "Sí. Si tienes dolor, inflamación o se te ha roto un diente, te buscamos un hueco de urgencia lo antes posible dentro de nuestro horario.",
    },
    {
      question: "¿Trabajáis con mutuas o seguros?",
      answer: "Trabajamos con varias mutuas y también con tarifas propias. Dinos cuál tienes y el equipo lo comprueba.",
    },
    {
      question: "¿Se puede pagar un tratamiento a plazos?",
      answer: "Sí, los tratamientos largos, como la ortodoncia o los implantes, se pueden financiar. Te explicamos las opciones en consulta.",
    },
    {
      question: "¿Qué tengo que llevar a la primera visita?",
      answer: "Si tienes informes o radiografías recientes, tráelos. Si vienes por una mutua, trae también su tarjeta.",
    },
    {
      question: "¿Cada cuánto conviene hacerse una limpieza?",
      answer: "En general, una o dos veces al año. Dura unos 45 minutos.",
    },
    {
      question: "¿Puedo cambiar o anular mi cita?",
      answer: "Sí, avísanos por aquí con 24 horas de antelación y te damos otra.",
    },
  ],
};
