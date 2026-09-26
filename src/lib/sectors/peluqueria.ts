// Peluquería/Estética: agenda by individual professional ([AGD-06]).
import { FRI, resource, SAT, serviceBuilder, THU, TUE, WED, weekly } from "./build";
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import type { SectorPreset } from "./schema";

const service = serviceBuilder({ minAdvanceMin: 60, maxAdvanceDays: 60 });
const MORNING: [string, string] = ["10:00", "14:00"];
const AFTERNOON: [string, string] = ["16:00", "20:00"];
const SATURDAY: [string, string] = ["09:00", "14:00"];
const STYLISTS = ["estilista-1", "estilista-2"];

export const peluqueria: SectorPreset = {
  slug: "peluqueria",
  label: "Peluquería/Estética",
  description: "Peluquerías, barberías y centros de estética con cita por profesional.",
  healthData: false,
  agendaMode: "individual",
  slotIntervalMin: 15,
  terminology: { booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" },
  businessHours: [...weekly([TUE, WED, THU, FRI], MORNING, AFTERNOON), ...weekly([SAT], SATURDAY)],
  resources: [
    resource({
      key: "estilista-1",
      type: "person",
      name: "Estilista 1",
      color: "violet",
      schedule: [...weekly([TUE, WED, THU, FRI], MORNING, AFTERNOON), ...weekly([SAT], SATURDAY)],
    }),
    resource({
      key: "estilista-2",
      type: "person",
      name: "Estilista 2",
      color: "blue",
      schedule: [...weekly([WED, THU, FRI], MORNING, AFTERNOON), ...weekly([SAT], SATURDAY)],
    }),
    resource({
      key: "esteticista",
      type: "person",
      name: "Esteticista",
      color: "pink",
      schedule: [...weekly([TUE, THU], AFTERNOON), ...weekly([FRI], MORNING, AFTERNOON), ...weekly([SAT], SATURDAY)],
    }),
  ],
  services: [
    service({
      key: "corte-mujer",
      name: "Corte de mujer",
      category: "Corte",
      durationMin: 45,
      descriptionForAgent: "Lavado, corte y secado con cepillo. Para cambios de look grandes, ofrece también color.",
      resourceKeys: STYLISTS,
    }),
    service({
      key: "corte-hombre",
      name: "Corte de hombre",
      category: "Corte",
      durationMin: 30,
      descriptionForAgent: "Corte con tijera o máquina, lavado incluido.",
      resourceKeys: STYLISTS,
    }),
    service({
      key: "corte-infantil",
      name: "Corte infantil",
      category: "Corte",
      durationMin: 30,
      descriptionForAgent: "Para niños y niñas hasta 12 años.",
      resourceKeys: STYLISTS,
    }),
    service({
      key: "lavado-peinado",
      name: "Lavado y peinado",
      category: "Peinado",
      durationMin: 30,
      descriptionForAgent: "Lavado y secado con cepillo o planchas. Para bodas y eventos, pasa con una persona.",
      resourceKeys: STYLISTS,
    }),
    service({
      key: "tinte-raiz",
      name: "Tinte de raíz",
      category: "Color",
      durationMin: 90,
      bufferAfterMin: 10,
      descriptionForAgent: "Color en la raíz, tiempo de exposición, lavado y peinado incluidos.",
      resourceKeys: STYLISTS,
    }),
    service({
      key: "mechas",
      name: "Mechas",
      category: "Color",
      durationMin: 120,
      bufferAfterMin: 10,
      descriptionForAgent: "Mechas con papel o balayage, con matiz y peinado. Duran unas dos horas.",
      resourceKeys: STYLISTS,
    }),
    service({
      key: "keratina",
      name: "Tratamiento de keratina",
      category: "Tratamientos",
      durationMin: 150,
      bufferAfterMin: 15,
      requiresManualConfirmation: true,
      descriptionForAgent:
        "Alisado con keratina. Antes se hace una prueba de mechón, por eso la cita la confirma el equipo: díselo al cliente.",
      resourceKeys: ["estilista-1"],
    }),
    service({
      key: "manicura",
      name: "Manicura",
      category: "Estética",
      durationMin: 45,
      descriptionForAgent: "Limado, cutículas y esmaltado normal o semipermanente.",
      resourceKeys: ["esteticista"],
    }),
    service({
      key: "arreglo-barba",
      name: "Arreglo de barba",
      category: "Barbería",
      durationMin: 20,
      descriptionForAgent: "Perfilado y arreglo de barba con navaja y toalla caliente.",
      resourceKeys: ["estilista-2"],
    }),
  ],
  agentTemplate: {
    name: "Asistente de citas",
    description: "Atiende dudas y gestiona las citas de la peluquería.",
    tone: "Cercano y alegre",
    instructions: {
      role: "Eres el asistente virtual de la peluquería. Atiendes a los clientes por WhatsApp, correo y el chat de la web: resuelves sus dudas y gestionas sus citas.",
      businessInfo:
        "Peluquería y centro de estética de barrio: cortes de mujer, hombre y niños, color (tintes y mechas), peinados, tratamientos, manicura y arreglo de barba. La dirección, el horario, los servicios y sus precios orientativos están en la información del negocio: usa siempre esos datos.",
      can: "Explicar los servicios, su duración y su precio orientativo; buscar huecos libres; reservar, cambiar o cancelar citas después de confirmar con el cliente el día, la hora y el servicio; resolver dudas con las preguntas frecuentes.",
      cannot: `No des consejos médicos sobre el cuero cabelludo ni diagnostiques problemas del pelo. No prometas descuentos ni ofertas que no estén en la información del negocio. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Cercano, alegre y breve, tratando de tú. Mensajes cortos, como en WhatsApp, y como mucho un emoji cuando encaje.",
      handoff:
        "Pasa la conversación a una persona si el cliente lo pide, si hay una queja o un resultado que no le ha gustado, si quiere presupuesto para una boda o un evento, o si no sabes responder después de intentarlo.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "novia", "boda"],
      sensitiveTopics: ["alergia a un producto", "reacción en la piel", "resultado que no le ha gustado"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Hace falta pedir cita?",
      answer:
        "Sí, trabajamos con cita para no hacerte esperar. Pídela por aquí y te buscamos hueco; si en ese momento hay alguien libre, también te atendemos sin cita.",
    },
    {
      question: "¿Puedo cambiar o cancelar mi cita?",
      answer: "Claro. Escríbenos por aquí, mejor con 24 horas de antelación, y la cambiamos o la anulamos sin problema.",
    },
    {
      question: "¿Cuánto dura un tinte o unas mechas?",
      answer: "Un tinte de raíz dura alrededor de hora y media, contando el tiempo de exposición. Las mechas, unas dos horas.",
    },
    {
      question: "¿Qué formas de pago aceptáis?",
      answer: "Efectivo, tarjeta y Bizum.",
    },
    {
      question: "¿Hacéis peinados para bodas y eventos?",
      answer:
        "Sí. Para novias y eventos preparamos un presupuesto a medida con una prueba previa. Dinos la fecha y te pasamos con el equipo.",
    },
    {
      question: "¿La keratina necesita una prueba antes?",
      answer:
        "Sí, antes de la keratina hacemos una prueba de mechón para ver cómo reacciona tu pelo. Por eso esa cita la confirma el equipo.",
    },
  ],
};
