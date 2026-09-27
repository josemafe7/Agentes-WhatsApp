// Default texts of the public legal pages and of the AI notice ([CUM-01], [CUM-02], [CUM-08]). They are used while
// Ajustes › Privacidad y legal leaves a text empty, filled with the business data. Simple format of
// src/lib/markdown.ts (# headings, - lists, **bold**); never HTML. Orientative: to be reviewed by the
// business with an adviser (the settings page says so).
import "server-only";
import type { RetentionSettings } from "@/db/schema";

/** First-message AI notice by default ([CUM-01]); it also offers a person at any time ([CUM-02]). */
export const DEFAULT_AI_DISCLOSURE_TEXT =
  "Hola, te atiende un asistente virtual con inteligencia artificial. Si prefieres hablar con una persona, dilo en cualquier momento.";

export type LegalTextKind = "privacy" | "terms" | "dataDeletion";

export type LegalBusinessData = {
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  retention: RetentionSettings;
};

const FALLBACK_NAME = "Este negocio";

function contactLine(data: LegalBusinessData): string {
  const ways = [data.contactEmail, data.contactPhone].filter((value): value is string => Boolean(value));
  return ways.length > 0 ? ways.join(" o al ") : "el mismo canal por el que nos escribiste";
}

function privacyText(data: LegalBusinessData, name: string): string {
  const where = data.address ? `, con domicilio en ${data.address}` : "";
  const { retention } = data;
  const afterExpiry = retention.mode === "anonymize" ? "se anonimizan" : "se borran";
  return `# Quién trata tus datos

${name}${where}. Puedes escribirnos a ${contactLine(data)}.

# Qué datos tratamos

Los que nos das al escribirnos por WhatsApp, por correo o por el chat de nuestra web: tu nombre, tu teléfono o tu email, lo que escribes, las notas de voz, imágenes y documentos que envías y las citas que reservas.

# Para qué los usamos

- Atender tus consultas y darte información sobre nuestros servicios.
- Gestionar tus citas y recordártelas.
- Pasarte con una persona del equipo cuando lo pidas o cuando haga falta.

Los tratamos porque nos lo pides y, cuando reservas, para prestarte el servicio. Los recordatorios se basan en nuestro interés en que no pierdas tu cita: puedes dejar de recibirlos escribiendo BAJA.

# Asistente con inteligencia artificial

Primero te atiende un asistente con inteligencia artificial. Puede equivocarse, y en cualquier momento puedes pedir hablar con una persona. No tomamos decisiones que te afecten de forma importante solo de manera automática.

# Quién más recibe tus datos

Solo los proveedores que necesitamos para atenderte, con contrato de encargo del tratamiento: el servicio de mensajería por el que nos escribes (por ejemplo, WhatsApp de Meta o tu proveedor de correo), el proveedor de inteligencia artificial que prepara las respuestas, al que no permitimos guardar ni usar tus datos, y el alojamiento de la aplicación. Si alguno está fuera de la Unión Europea, lo hace con las garantías que exige el Reglamento General de Protección de Datos.

# Cuánto tiempo los guardamos

- Conversaciones: ${retention.conversationsMonths} meses.
- Notas de voz: ${retention.audioDays} días después de transcribirlas.
- Archivos adjuntos: ${retention.attachmentsDays} días.
- Registros técnicos de los mensajes recibidos: ${retention.webhookDays} días.

Pasado ese tiempo ${afterExpiry}. Las citas se guardan mientras hagan falta para atenderte y para cumplir nuestras obligaciones legales.

# Tus derechos

Puedes pedir el acceso, la rectificación, la supresión, la limitación y la portabilidad de tus datos, y oponerte a que los tratemos, escribiendo a ${contactLine(data)}. Si crees que no hemos atendido bien tu petición, puedes reclamar ante la Agencia Española de Protección de Datos (https://www.aepd.es).`;
}

function termsText(data: LegalBusinessData, name: string): string {
  return `# Qué es este servicio

${name} atiende tus consultas por WhatsApp, por correo y por el chat de su web con la ayuda de un asistente con inteligencia artificial y de su equipo.

# El asistente con inteligencia artificial

- Te responde con la información del negocio, pero puede equivocarse: confirma con nosotros lo importante, como precios, horarios o citas.
- En cualquier momento puedes pedir hablar con una persona y te pasamos con alguien del equipo.
- No envíes datos de tarjetas, contraseñas ni documentos de identidad por este canal.

# Citas

Una cita está reservada cuando te la confirmamos por este mismo canal. Si no puedes venir, avísanos para dejar el hueco a otra persona.

# Mensajes y bajas

Solo te escribimos para atender tus consultas y recordarte tus citas. Si no quieres recibir más mensajes por un canal, escribe BAJA o STOP en esa conversación.

# Uso correcto

No uses este servicio para enviar contenido ilegal u ofensivo o que no tenga que ver con el negocio. Podemos dejar de atender las conversaciones que no lo respeten.

# Contacto

Para cualquier duda, escríbenos a ${contactLine(data)}.`;
}

function dataDeletionText(data: LegalBusinessData, name: string): string {
  return `# Cómo pedir que borremos tus datos

Puedes pedir en cualquier momento que ${name} borre los datos que tiene sobre ti: conversaciones, datos de contacto y citas.

- Escríbenos a ${contactLine(data)} e indica el teléfono, el email o el canal desde el que nos escribiste.
- También puedes pedirlo en la misma conversación.

# Qué hacemos después

Comprobamos que la petición es tuya y borramos tus datos en un plazo máximo de un mes. Te confirmamos el borrado por el mismo medio. Solo guardamos lo que una ley nos obligue a conservar, y durante el plazo que marque.

# Dejar de recibir mensajes

Si solo quieres dejar de recibir mensajes por un canal, escribe BAJA o STOP en esa conversación.

# Si nos escribiste por WhatsApp

Al borrar tus datos borramos también las conversaciones guardadas en nuestra aplicación. Los mensajes que tienes en tu teléfono los gestionas tú desde WhatsApp.`;
}

/** The three default legal texts with the business data. */
export function defaultLegalTexts(data: LegalBusinessData): Record<LegalTextKind, string> {
  const name = data.name.trim() || FALLBACK_NAME;
  return {
    privacy: privacyText(data, name),
    terms: termsText(data, name),
    dataDeletion: dataDeletionText(data, name),
  };
}
