// Taller: agenda by individual bay (box) ([AGD-06]).
import { FRI, MON, MON_TO_FRI, resource, serviceBuilder, THU, TUE, WED, weekly } from "./build";
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import type { SectorPreset } from "./schema";

const service = serviceBuilder({ minAdvanceMin: 24 * 60, maxAdvanceDays: 60 });
const MORNING: [string, string] = ["08:30", "13:30"];
const AFTERNOON: [string, string] = ["15:00", "19:00"];
const BAYS = ["box-1", "box-2"];
/** Time to move the car out of the bay and hand it over. */
const HANDOVER_MIN = 15;

export const taller: SectorPreset = {
  slug: "taller",
  label: "Taller",
  description: "Talleres mecánicos con citas por box o elevador.",
  healthData: false,
  agendaMode: "individual",
  slotIntervalMin: 15,
  terminology: { booking: "cita", bookings: "citas", resource: "box", resources: "boxes", customer: "cliente" },
  businessHours: weekly(MON_TO_FRI, MORNING, AFTERNOON),
  resources: [
    resource({ key: "box-1", type: "room", name: "Box 1", color: "blue", schedule: weekly(MON_TO_FRI, MORNING, AFTERNOON) }),
    resource({
      key: "box-2",
      type: "room",
      name: "Box 2",
      color: "orange",
      schedule: [...weekly([MON, TUE, WED, THU], MORNING, AFTERNOON), ...weekly([FRI], MORNING)],
    }),
  ],
  services: [
    service({
      key: "cambio-aceite",
      name: "Cambio de aceite y filtros",
      category: "Mantenimiento",
      durationMin: 60,
      bufferAfterMin: HANDOVER_MIN,
      descriptionForAgent: "Aceite, filtro de aceite y revisión de niveles. Pregunta la marca, el modelo y los kilómetros del coche.",
      resourceKeys: BAYS,
    }),
    service({
      key: "revision-pre-itv",
      name: "Revisión pre-ITV",
      category: "Mantenimiento",
      durationMin: 60,
      bufferAfterMin: HANDOVER_MIN,
      descriptionForAgent: "Se revisan luces, frenos, neumáticos, emisiones y todo lo que miran en la ITV.",
      resourceKeys: BAYS,
    }),
    service({
      key: "diagnosis",
      name: "Diagnosis electrónica",
      category: "Diagnóstico",
      durationMin: 45,
      bufferAfterMin: HANDOVER_MIN,
      descriptionForAgent: "Lectura de averías con la máquina de diagnosis cuando se enciende un testigo en el cuadro.",
      resourceKeys: ["box-1"],
    }),
    service({
      key: "neumaticos",
      name: "Cambio de neumáticos",
      category: "Neumáticos",
      durationMin: 45,
      bufferAfterMin: HANDOVER_MIN,
      descriptionForAgent: "Montaje, equilibrado y válvulas. Pregunta la medida del neumático si el cliente la sabe.",
      resourceKeys: BAYS,
    }),
    service({
      key: "frenos",
      name: "Revisión de frenos",
      category: "Mantenimiento",
      durationMin: 60,
      bufferAfterMin: HANDOVER_MIN,
      descriptionForAgent: "Pastillas, discos y líquido de frenos. Si el cliente nota que el coche no frena bien, que no lo use y pase con una persona.",
      resourceKeys: BAYS,
    }),
    service({
      key: "aire-acondicionado",
      name: "Carga de aire acondicionado",
      category: "Climatización",
      durationMin: 45,
      bufferAfterMin: HANDOVER_MIN,
      descriptionForAgent: "Comprobación de fugas y recarga del gas del aire acondicionado.",
      resourceKeys: ["box-2"],
    }),
    service({
      key: "valoracion-chapa",
      name: "Valoración de chapa y pintura",
      category: "Chapa y pintura",
      durationMin: 30,
      requiresManualConfirmation: true,
      descriptionForAgent:
        "Revisión de golpes o arañazos para dar presupuesto. La cita la confirma el equipo; si hay seguro de por medio, pide el nombre de la aseguradora.",
      resourceKeys: ["box-1"],
    }),
  ],
  agentTemplate: {
    name: "Recepción del taller",
    description: "Atiende a los clientes y gestiona las citas del taller.",
    tone: "Claro, práctico y de confianza",
    instructions: {
      role: "Eres el asistente virtual de recepción del taller. Atiendes por WhatsApp, correo y el chat de la web: resuelves dudas y das cita para revisiones y reparaciones.",
      businessInfo:
        "Taller mecánico multimarca de turismos: mantenimiento, pre-ITV, diagnosis, neumáticos, frenos, aire acondicionado y chapa y pintura. La dirección, el horario, los servicios y sus precios orientativos están en la información del negocio: usa siempre esos datos.",
      can: "Explicar los servicios; preguntar marca, modelo, año y kilómetros del coche; buscar huecos y reservar, cambiar o cancelar citas después de confirmar el día, la hora y el servicio; resolver dudas con las preguntas frecuentes.",
      cannot: `No des presupuestos cerrados ni diagnósticos a distancia: el mecánico tiene que ver el coche. No digas que un coche es seguro para circular. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Claro y práctico, tratando de tú, sin tecnicismos innecesarios.",
      handoff:
        "Pasa la conversación a una persona si el cliente lo pide, si habla de una avería grave o de un coche que no arranca o no frena, de un siniestro con el seguro, de una garantía o de una queja, o si no sabes responder.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "grúa", "siniestro", "garantía"],
      sensitiveTopics: ["frenos que fallan", "accidente", "coche que no arranca"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Me dais presupuesto antes de reparar?",
      answer: "Siempre. Revisamos el coche, te damos el presupuesto y no tocamos nada sin tu aprobación.",
    },
    {
      question: "¿Cuánto tarda un cambio de aceite?",
      answer: "Alrededor de una hora. Puedes esperar en el taller o dejarnos el coche y te avisamos cuando esté listo.",
    },
    {
      question: "¿Tenéis coche de sustitución?",
      answer: "Tenemos pocos coches de sustitución, para reparaciones largas. Pídelo al reservar y te confirmamos si hay uno libre.",
    },
    {
      question: "¿Trabajáis con todas las marcas?",
      answer: "Sí, hacemos mantenimiento y reparaciones de turismos de cualquier marca, sin perder la garantía del fabricante.",
    },
    {
      question: "¿Hacéis la revisión antes de pasar la ITV?",
      answer: "Sí: comprobamos luces, frenos, neumáticos, emisiones y todo lo que miran en la inspección.",
    },
    {
      question: "¿Puedo dejar el coche el día antes?",
      answer: "Sí, avísanos y lo organizamos para que lo dejes la tarde anterior.",
    },
  ],
};
