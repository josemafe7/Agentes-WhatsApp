// Routes of the agenda configuration (docs/pantallas.md «Configuración de la agenda», «Servicios», «Recursos»).
export const AGENDA_PATH = "/agenda";
export const AGENDA_CONFIG_PATH = "/agenda/configuracion";
export const SERVICES_PATH = `${AGENDA_CONFIG_PATH}/servicios`;
export const RESOURCES_PATH = `${AGENDA_CONFIG_PATH}/recursos`;
export const NEW_RESOURCE_PATH = `${RESOURCES_PATH}/nuevo`;
/** Business hours, holidays and closures live in Ajustes › Horario ([AJU-03]) and limit the agenda ([AGD-05]). */
export const BUSINESS_HOURS_PATH = "/ajustes/horario";
export const REMINDERS_PATH = "/ajustes/recordatorios";

export const resourcePath = (id: string) => `${RESOURCES_PATH}/${id}`;
