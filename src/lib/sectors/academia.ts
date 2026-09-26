// Academia/Clases: agenda by capacity (places per classroom) ([AGD-06]).
import { FRI, MON, resource, SAT, serviceBuilder, THU, TUE, WED, weekly } from "./build";
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import type { SectorPreset } from "./schema";

const service = serviceBuilder({ minAdvanceMin: 12 * 60, maxAdvanceDays: 60 });
const MORNING: [string, string] = ["10:00", "13:00"];
const AFTERNOON: [string, string] = ["16:00", "21:30"];
const FRIDAY: [string, string] = ["16:00", "20:00"];
const SATURDAY: [string, string] = ["10:00", "14:00"];
const MON_TO_THU = [MON, TUE, WED, THU];
const HOURS = [...weekly(MON_TO_THU, MORNING, AFTERNOON), ...weekly([FRI], FRIDAY), ...weekly([SAT], SATURDAY)];
const CLASSROOMS = ["aula-1", "aula-2"];
const PLACES_PER_GROUP = 8;
/** A booking is one student, or two siblings or friends who come together. */
const MAX_PEOPLE_PER_BOOKING = 2;

export const academia: SectorPreset = {
  slug: "academia",
  label: "Academia/Clases",
  description: "Academias de idiomas, refuerzo escolar y clases con plazas por grupo.",
  healthData: false,
  agendaMode: "capacity",
  slotIntervalMin: 30,
  terminology: { booking: "reserva", bookings: "reservas", resource: "sala", resources: "salas", customer: "cliente" },
  businessHours: HOURS,
  resources: [
    resource({ key: "aula-1", type: "room", name: "Aula 1", color: "blue", capacity: PLACES_PER_GROUP, schedule: HOURS }),
    resource({
      key: "aula-2",
      type: "room",
      name: "Aula 2",
      color: "violet",
      capacity: PLACES_PER_GROUP,
      schedule: [...weekly(MON_TO_THU, AFTERNOON), ...weekly([FRI], FRIDAY)],
    }),
    resource({
      key: "tutorias",
      type: "room",
      name: "Sala de tutorías",
      color: "teal",
      schedule: [...weekly(MON_TO_THU, MORNING, AFTERNOON), ...weekly([SAT], SATURDAY)],
    }),
  ],
  services: [
    service({
      key: "ingles-grupo",
      name: "Clase de inglés en grupo",
      category: "Idiomas",
      durationMin: 60,
      bufferAfterMin: 10,
      maxPeople: MAX_PEOPLE_PER_BOOKING,
      descriptionForAgent: "Grupos reducidos por niveles (A1 a C1), para adultos y adolescentes.",
      resourceKeys: CLASSROOMS,
    }),
    service({
      key: "refuerzo-escolar",
      name: "Refuerzo escolar en grupo",
      category: "Refuerzo",
      durationMin: 60,
      bufferAfterMin: 10,
      maxPeople: MAX_PEOPLE_PER_BOOKING,
      descriptionForAgent: "Apoyo con deberes y asignaturas de Primaria y ESO en grupos reducidos.",
      resourceKeys: CLASSROOMS,
    }),
    service({
      key: "preparacion-examen",
      name: "Preparación de examen oficial",
      category: "Idiomas",
      durationMin: 90,
      bufferAfterMin: 10,
      descriptionForAgent: "Preparación de exámenes oficiales de inglés (B1, B2 y C1) con simulacros.",
      resourceKeys: ["aula-2"],
    }),
    service({
      key: "clase-particular",
      name: "Clase particular",
      category: "Particulares",
      durationMin: 60,
      descriptionForAgent: "Clase individual de inglés o de refuerzo, con el contenido a medida del alumno.",
      resourceKeys: ["tutorias"],
    }),
    service({
      key: "clase-prueba",
      name: "Clase de prueba",
      category: "Primer contacto",
      durationMin: 60,
      bufferAfterMin: 10,
      requiresManualConfirmation: true,
      descriptionForAgent:
        "Primera clase para conocer la academia y hacer la prueba de nivel. La confirma el equipo para colocar al alumno en el grupo adecuado.",
      resourceKeys: CLASSROOMS,
    }),
  ],
  agentTemplate: {
    name: "Información y reservas",
    description: "Informa sobre cursos y grupos y gestiona reservas de clases.",
    tone: "Cercano, motivador y claro",
    instructions: {
      role: "Eres el asistente virtual de la academia. Atiendes por WhatsApp, correo y el chat de la web a alumnos y familias: informas de cursos y grupos y gestionas reservas de clases.",
      businessInfo:
        "Academia de idiomas y refuerzo escolar: grupos reducidos por niveles, clases particulares, preparación de exámenes oficiales y clase de prueba. La dirección, el horario, los cursos y sus precios orientativos están en la información del negocio: usa siempre esos datos.",
      can: "Explicar cursos, niveles y horarios; preguntar edad y nivel del alumno; buscar plaza y reservar, cambiar o cancelar clases después de confirmar el día, la hora y el grupo; resolver dudas con las preguntas frecuentes.",
      cannot: `No garantices aprobar un examen ni asignes un nivel sin prueba. No cierres matrículas ni condiciones de pago especiales. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Cercano y motivador, tratando de tú. Mensajes cortos y claros, también para familias.",
      handoff:
        "Pasa la conversación a una persona si lo piden, si preguntan por matrículas, becas, descuentos o necesidades educativas especiales, si hay una queja o si no sabes responder.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "matrícula", "beca", "descuento"],
      sensitiveTopics: ["necesidades educativas especiales", "problema con un profesor"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Hay clase de prueba?",
      answer: "Sí, la primera clase es de prueba y sirve también para ver tu nivel. Te la reservamos en el grupo que mejor encaje.",
    },
    {
      question: "¿Cuántos alumnos hay por grupo?",
      answer: "Como máximo 8, para que todos puedan participar.",
    },
    {
      question: "¿Cómo sé qué nivel tengo?",
      answer: "Hacemos una prueba de nivel corta en la clase de prueba y te recomendamos el grupo adecuado.",
    },
    {
      question: "¿Preparáis exámenes oficiales?",
      answer: "Sí, preparamos los exámenes oficiales de inglés de nivel B1, B2 y C1, con simulacros.",
    },
    {
      question: "¿Qué pasa si falto a una clase?",
      answer: "Avísanos antes y, si hay plaza, puedes recuperarla esa misma semana en otro grupo de tu nivel.",
    },
    {
      question: "¿Cómo se paga?",
      answer: "Por meses, con domiciliación bancaria o con tarjeta en la academia.",
    },
  ],
};
