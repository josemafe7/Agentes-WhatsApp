// Restaurante: agenda by capacity (total seats per room, table time and group size) ([AGD-06], [AGD-11]).
import { FRI, resource, SAT, serviceBuilder, SUN, THU, TUE, WED, weekly } from "./build";
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import type { SectorPreset } from "./schema";

const service = serviceBuilder({ minAdvanceMin: 60, maxAdvanceDays: 60 });
const LUNCH: [string, string] = ["13:00", "16:00"];
const DINNER: [string, string] = ["20:00", "23:30"];
const SUNDAY_LUNCH: [string, string] = ["13:00", "16:30"];
const OPEN_DAYS = [TUE, WED, THU, FRI, SAT];
/** Time to clear and set the table again. */
const TABLE_TURNOVER_MIN = 15;
const LARGEST_TABLE_GROUP = 8;

export const restaurante: SectorPreset = {
  slug: "restaurante",
  label: "Restaurante",
  description: "Restaurantes y bares con reservas por aforo de cada sala.",
  healthData: false,
  agendaMode: "capacity",
  slotIntervalMin: 15,
  terminology: { booking: "reserva", bookings: "reservas", resource: "sala", resources: "salas", customer: "comensal" },
  businessHours: [...weekly(OPEN_DAYS, LUNCH, DINNER), ...weekly([SUN], SUNDAY_LUNCH)],
  resources: [
    resource({
      key: "comedor",
      type: "table",
      name: "Comedor",
      color: "amber",
      capacity: 40,
      schedule: [...weekly(OPEN_DAYS, LUNCH, DINNER), ...weekly([SUN], SUNDAY_LUNCH)],
    }),
    resource({
      key: "terraza",
      type: "table",
      name: "Terraza",
      color: "emerald",
      capacity: 24,
      schedule: [...weekly(OPEN_DAYS, LUNCH, DINNER), ...weekly([SUN], SUNDAY_LUNCH)],
    }),
  ],
  services: [
    service({
      key: "reserva-mesa",
      name: "Reserva de mesa",
      category: "Reservas",
      durationMin: 90,
      bufferAfterMin: TABLE_TURNOVER_MIN,
      maxPeople: LARGEST_TABLE_GROUP,
      descriptionForAgent:
        "Mesa para comer o cenar, de 1 a 8 personas. Pregunta siempre cuántos sois, el día, la hora y si preferís comedor o terraza, y anota alergias o tronas en las notas.",
      resourceKeys: ["comedor", "terraza"],
    }),
    service({
      key: "grupo",
      name: "Reserva de grupo",
      category: "Grupos",
      durationMin: 120,
      bufferAfterMin: TABLE_TURNOVER_MIN,
      minPeople: LARGEST_TABLE_GROUP + 1,
      maxPeople: 20,
      minAdvanceMin: 24 * 60,
      maxAdvanceDays: 90,
      requiresManualConfirmation: true,
      descriptionForAgent:
        "Grupos de 9 a 20 personas en el comedor. La reserva la confirma el equipo, que puede proponer un menú cerrado: díselo al cliente.",
      resourceKeys: ["comedor"],
    }),
  ],
  agentTemplate: {
    name: "Reservas del restaurante",
    description: "Atiende las reservas y las dudas de los clientes del restaurante.",
    tone: "Cálido y resolutivo",
    instructions: {
      role: "Eres el asistente virtual de reservas del restaurante. Atiendes por WhatsApp, correo y el chat de la web: gestionas reservas y respondes dudas sobre la carta, los horarios y el local.",
      businessInfo:
        "Restaurante con comedor y terraza, abierto a mediodía y por la noche. La dirección, el horario y la información de la carta están en la información del negocio y en los documentos: usa siempre esos datos.",
      can: "Buscar disponibilidad y reservar, cambiar o cancelar reservas después de confirmar el día, la hora, el número de personas y la zona; anotar alergias, tronas o celebraciones en las notas; responder dudas con las preguntas frecuentes y la carta.",
      cannot: `No garantices que un plato sea apto para una alergia grave: anótalo y dile al cliente que lo avise también al llegar. No confirmes grupos de más de 8 personas por tu cuenta. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Cálido y resolutivo, tratando de tú. Mensajes cortos y con los datos de la reserva bien claros al confirmarla.",
      handoff:
        "Pasa la conversación a una persona si el cliente lo pide, si es un grupo grande, un evento o una celebración privada, si hay una queja sobre una comida o si no sabes responder.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "evento", "comunión", "cumpleaños", "menú de grupo"],
      sensitiveTopics: ["alergia grave", "intoxicación", "queja sobre una comida"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Tenéis opciones sin gluten o veganas?",
      answer:
        "Sí, tenemos platos sin gluten y opciones vegetarianas y veganas. Avísanos de cualquier alergia al reservar y la cocina lo tendrá en cuenta.",
    },
    {
      question: "¿Se puede reservar para un grupo grande?",
      answer:
        "Sí. Para más de 8 personas preparamos la reserva a medida: dinos el día, la hora y cuántos sois, y el equipo te la confirma.",
    },
    {
      question: "¿Tenéis terraza?",
      answer: "Sí. Si la prefieres, dilo al reservar; depende del tiempo y de la disponibilidad.",
    },
    {
      question: "¿Cuánto tiempo me guardáis la mesa?",
      answer: "Guardamos la mesa 15 minutos. Si vas a llegar más tarde, escríbenos y te la mantenemos si podemos.",
    },
    {
      question: "¿Se admiten perros?",
      answer: "En la terraza, sí. Dentro del comedor, solo perros de asistencia.",
    },
    {
      question: "¿Tenéis menú del día?",
      answer: "Sí, de martes a viernes a mediodía, con primero, segundo y postre. Cambia cada semana.",
    },
  ],
};
