// The fictional business of each sector's demo: contact data, colour, names of its people and example prices.
// Only the demo uses this; a real business starts from the bare sector preset (src/lib/sectors).
// Emails and websites use the reserved `.example` domain; nothing here is a real business.
import type { Sector } from "@/lib/enums";

export type DemoBusiness = {
  name: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  website: string;
  /** Main colour ([AJU-01]). */
  color: string;
  /** Display names of the preset's resources, by key. */
  resourceNames: Readonly<Record<string, string>>;
  /** Indicative example prices in euros, by service key. */
  servicePrices: Readonly<Record<string, number>>;
};

const MADRID = "28015 Madrid";

export const DEMO_BUSINESSES: Readonly<Record<Sector, DemoBusiness>> = {
  peluqueria: {
    name: "Peluquería Aurora",
    contactEmail: "hola@peluqueria-aurora.example",
    contactPhone: "+34 910 000 101",
    address: `Calle de los Tilos 14, ${MADRID}`,
    website: "https://peluqueria-aurora.example",
    color: "#b4235a",
    resourceNames: { "estilista-1": "Lucía", "estilista-2": "Andrés", esteticista: "Marta" },
    servicePrices: {
      "corte-mujer": 22,
      "corte-hombre": 14,
      "corte-infantil": 10,
      "lavado-peinado": 16,
      "tinte-raiz": 35,
      mechas: 65,
      keratina: 120,
      manicura: 15,
      "arreglo-barba": 10,
    },
  },
  "clinica-dental": {
    name: "Clínica Dental Lumen",
    contactEmail: "citas@clinica-lumen.example",
    contactPhone: "+34 910 000 102",
    address: `Calle del Olmo 3, ${MADRID}`,
    website: "https://clinica-lumen.example",
    color: "#0f766e",
    resourceNames: { "dentista-1": "Dra. Paula Ortega", "dentista-2": "Dr. Miguel Serrano", higienista: "Irene (higienista)" },
    servicePrices: {
      "primera-visita": 30,
      limpieza: 55,
      empaste: 60,
      endodoncia: 240,
      blanqueamiento: 280,
      "revision-ortodoncia": 0,
      urgencia: 45,
    },
  },
  fisioterapia: {
    name: "Fisioterapia Movimiento",
    contactEmail: "hola@fisio-movimiento.example",
    contactPhone: "+34 910 000 103",
    address: `Calle de la Encina 21, ${MADRID}`,
    website: "https://fisio-movimiento.example",
    color: "#15803d",
    resourceNames: { "fisio-1": "Álvaro Díaz", "fisio-2": "Nuria Campos" },
    servicePrices: {
      "primera-valoracion": 50,
      "sesion-fisioterapia": 40,
      "masaje-descontracturante": 45,
      "puncion-seca": 35,
      "fisioterapia-deportiva": 50,
    },
  },
  restaurante: {
    name: "Restaurante La Encina",
    contactEmail: "reservas@laencina.example",
    contactPhone: "+34 910 000 104",
    address: `Plaza del Roble 5, ${MADRID}`,
    website: "https://laencina.example",
    color: "#b45309",
    resourceNames: {},
    servicePrices: {},
  },
  taller: {
    name: "Talleres Hermanos Gil",
    contactEmail: "taller@hermanosgil.example",
    contactPhone: "+34 910 000 105",
    address: `Calle del Motor 8, ${MADRID}`,
    website: "https://hermanosgil.example",
    color: "#1d4ed8",
    resourceNames: {},
    servicePrices: {
      "cambio-aceite": 75,
      "revision-pre-itv": 30,
      diagnosis: 40,
      neumaticos: 20,
      frenos: 25,
      "aire-acondicionado": 60,
      "valoracion-chapa": 0,
    },
  },
  academia: {
    name: "Academia Delta",
    contactEmail: "info@academia-delta.example",
    contactPhone: "+34 910 000 106",
    address: `Calle del Aula 11, ${MADRID}`,
    website: "https://academia-delta.example",
    color: "#7c3aed",
    resourceNames: { "aula-1": "Aula Londres", "aula-2": "Aula Dublín" },
    servicePrices: {
      "ingles-grupo": 15,
      "refuerzo-escolar": 12,
      "preparacion-examen": 20,
      "clase-particular": 30,
      "clase-prueba": 0,
    },
  },
  inmobiliaria: {
    name: "Inmobiliaria Puerta Norte",
    contactEmail: "hola@puertanorte.example",
    contactPhone: "+34 910 000 107",
    address: `Avenida de los Pinos 40, ${MADRID}`,
    website: "https://puertanorte.example",
    color: "#0e7490",
    resourceNames: { "profesional-1": "Raquel (agente)", "profesional-2": "Daniel (agente)" },
    servicePrices: {},
  },
  tienda: {
    name: "Tienda Olivo",
    contactEmail: "hola@tienda-olivo.example",
    contactPhone: "+34 910 000 108",
    address: `Calle del Mercado 7, ${MADRID}`,
    website: "https://tienda-olivo.example",
    color: "#4d7c0f",
    resourceNames: { "profesional-1": "Carla", "profesional-2": "Jorge" },
    servicePrices: {},
  },
  otro: {
    name: "Estudio Norte",
    contactEmail: "hola@estudio-norte.example",
    contactPhone: "+34 910 000 109",
    address: `Calle del Norte 2, ${MADRID}`,
    website: "https://estudio-norte.example",
    color: "#3d6df2",
    resourceNames: { "profesional-1": "Raúl", "profesional-2": "Ana" },
    servicePrices: {},
  },
};
