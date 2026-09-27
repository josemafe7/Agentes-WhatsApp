// What a booking reminder can say ([AGD-24]): the booking data a WhatsApp template variable or an email placeholder
// may be filled with. Pure data and text, shared by Agenda › Configuración (to offer and validate the mapping) and the
// reminder job. A WhatsApp template maps each of its variables to one of these keys (reminder_settings.
// template_variables, e.g. {"1": "contact.name", "2": "booking.date"}); the email writes {placeholder}.
import "server-only";

export const REMINDER_FIELDS = [
  { key: "contact.name", placeholder: "nombre", label: "Nombre del cliente" },
  { key: "service.name", placeholder: "servicio", label: "Servicio" },
  { key: "booking.date", placeholder: "fecha", label: "Día («martes 29 de septiembre»)" },
  { key: "booking.time", placeholder: "hora", label: "Hora («10:00»)" },
  { key: "resource.name", placeholder: "recurso", label: "Profesional, mesa o sala" },
  { key: "booking.people", placeholder: "personas", label: "Personas" },
  { key: "business.name", placeholder: "negocio", label: "Nombre del negocio" },
] as const;

export type ReminderFieldKey = (typeof REMINDER_FIELDS)[number]["key"];
export type ReminderValues = Record<ReminderFieldKey, string>;

const KEYS = new Set<string>(REMINDER_FIELDS.map((field) => field.key));

export function isReminderFieldKey(value: string): value is ReminderFieldKey {
  return KEYS.has(value);
}

/** A mapping that points to something that is not a booking field. */
export class ReminderMappingError extends Error {
  constructor(readonly variable: string) {
    super(`La variable ${variable} de la plantilla no tiene un dato de la cita asignado.`);
    this.name = "ReminderMappingError";
  }
}

/** Template variable → its value for this booking. Throws ReminderMappingError for a key that is not a field. */
export function templateVariablesFor(mapping: Readonly<Record<string, string>>, values: ReminderValues): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [variable, key] of Object.entries(mapping)) {
    if (!isReminderFieldKey(key)) throw new ReminderMappingError(variable);
    // Meta rejects empty parameters: a missing value becomes a dash.
    result[variable] = values[key].trim() || "-";
  }
  return result;
}

const PLACEHOLDER = /\{([a-z]+)\}/g;
const BY_PLACEHOLDER = new Map<string, ReminderFieldKey>(REMINDER_FIELDS.map((field) => [field.placeholder, field.key]));

/** Fills {nombre}, {fecha}… in a text; unknown placeholders stay as written. */
export function renderReminderText(template: string, values: ReminderValues): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const key = BY_PLACEHOLDER.get(name);
    return key ? values[key] : whole;
  });
}

/** Default email when the business writes none, with its word for a booking («cita», «reserva»). */
export function defaultReminderEmail(bookingWord: string): { subject: string; body: string } {
  return {
    subject: `Recordatorio de tu ${bookingWord} en {negocio}`,
    body:
      `Hola, {nombre}:\n\nTe recordamos tu ${bookingWord} de {servicio} el {fecha} a las {hora}.\n\n` +
      `Si no puedes venir, avísanos para dejar el hueco libre. ¡Gracias!`,
  };
}
