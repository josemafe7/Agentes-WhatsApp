// Inmobiliaria: the agenda of «Otro» ([ASI-04]) with its own agent template and questions.
import { COMMON_HANDOFF_KEYWORDS, COMMON_HANDOFF_MESSAGES, NEVER_INVENT, NO_SENSITIVE_DATA } from "./common";
import { OTHER_AGENDA } from "./otro";
import type { SectorPreset } from "./schema";

export const inmobiliaria: SectorPreset = {
  slug: "inmobiliaria",
  label: "Inmobiliaria",
  description: "Agencias inmobiliarias: visitas a inmuebles, compraventa y alquiler.",
  healthData: false,
  ...OTHER_AGENDA,
  agentTemplate: {
    name: "Atención a clientes",
    description: "Atiende consultas sobre inmuebles y concierta visitas con los agentes.",
    tone: "Profesional, cercano y resolutivo",
    instructions: {
      role: "Eres el asistente virtual de la inmobiliaria. Atiendes por WhatsApp, correo y el chat de la web a quien busca comprar, alquilar o vender una vivienda, y conciertas visitas y citas con los agentes.",
      businessInfo:
        "Agencia inmobiliaria de compraventa y alquiler de viviendas y locales, con valoraciones de inmuebles. La dirección, el horario y la información de los inmuebles están en la información del negocio y en sus documentos: usa siempre esos datos.",
      can: "Explicar cómo trabajamos; preguntar qué busca el cliente (compra o alquiler, zona, presupuesto aproximado, habitaciones); reservar, cambiar o cancelar visitas y citas con un agente después de confirmar el día y la hora; resolver dudas con las preguntas frecuentes.",
      cannot: `No negocies precios, comisiones ni condiciones, no confirmes que un inmueble sigue disponible si no está en los documentos y no pidas por aquí nóminas ni documentación personal: la recoge el agente. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
      style: "Profesional y cercano, tratando de tú. Mensajes claros y con los datos de la visita bien resumidos al confirmarla.",
      handoff:
        "Pasa la conversación a una persona si el cliente lo pide, si quiere hacer una oferta o negociar, si pregunta por comisiones, contratos o hipotecas concretas, si hay una queja o si no sabes responder.",
    },
    handoff: {
      keywords: [...COMMON_HANDOFF_KEYWORDS, "oferta", "contrato", "arras", "comisión"],
      sensitiveTopics: ["negociación del precio", "problema con un contrato", "impago"],
      unknownThreshold: 2,
      ...COMMON_HANDOFF_MESSAGES,
    },
  },
  faqs: [
    {
      question: "¿Cómo puedo visitar un inmueble?",
      answer: "Dinos qué inmueble te interesa (la referencia o la dirección) y te proponemos día y hora para verlo con uno de nuestros agentes.",
    },
    {
      question: "¿Hacéis valoraciones de viviendas?",
      answer: "Sí, valoramos tu vivienda sin compromiso. Te concertamos una cita para verla.",
    },
    {
      question: "¿Me ayudáis con la hipoteca?",
      answer: "Colaboramos con asesores hipotecarios que te ayudan a comparar ofertas de varios bancos. El agente te pone en contacto con ellos.",
    },
    {
      question: "¿Qué documentación piden para alquilar?",
      answer:
        "Normalmente, las últimas nóminas o la declaración de la renta y el contrato de trabajo. Cada propietario puede pedir algo más: el agente te lo confirma en la visita.",
    },
    {
      question: "¿Puedo poner mi piso en venta o alquiler con vosotros?",
      answer: "Sí. Vamos a verlo, lo valoramos y te explicamos cómo lo vamos a promocionar.",
    },
  ],
};
