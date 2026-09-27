// Example legal texts and AI notice of the demo business ([AJU-07], [CUM-01], [CUM-08]). Real businesses write
// their own in Settings › Privacidad y legal; these say they are examples.
import { DEFAULT_RETENTION } from "@/db/schema";
import type { DemoBusiness } from "./businesses";

export function demoLegalTexts(business: DemoBusiness) {
  const { name, contactEmail } = business;
  return {
    privacyText: [
      `${name} trata tus datos (nombre, forma de contacto y mensajes) para atender tus consultas y gestionar tus citas.`,
      "Las respuestas automáticas las prepara un asistente de inteligencia artificial; siempre puedes pedir que te atienda una persona.",
      `Guardamos las conversaciones ${DEFAULT_RETENTION.conversationsMonths} meses como máximo y puedes pedir ver, corregir o borrar tus datos escribiendo a ${contactEmail}.`,
      "Texto de ejemplo de la demo: cada negocio debe revisarlo con su asesor.",
    ].join("\n\n"),
    termsText: [
      `Estas condiciones regulan el uso de los canales de atención de ${name} (WhatsApp, correo y chat de la web).`,
      "Las citas se pueden cambiar o anular avisando con antelación. La información de precios es orientativa.",
      "Texto de ejemplo de la demo: cada negocio debe revisarlo con su asesor.",
    ].join("\n\n"),
    dataDeletionText: [
      `Para borrar tus datos, pídelo por cualquiera de nuestros canales o escribe a ${contactEmail}.`,
      "Borraremos tus conversaciones y tus datos de contacto en un plazo máximo de 30 días y te lo confirmaremos.",
      "Texto de ejemplo de la demo.",
    ].join("\n\n"),
    aiDisclosureText: `Hola, soy el asistente virtual de ${name}, una inteligencia artificial. Si prefieres hablar con una persona del equipo, dímelo cuando quieras.`,
  };
}
