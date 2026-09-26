// System tools an agent can use ([HER-01], [AGE-08]). Pure data shared by the editor, the data layer and the AI
// layer. Which ones already work is decided on the server (src/server/ai/tools); the rest arrive with their phase.

export const SYSTEM_TOOL_NAMES = [
  "buscar_conocimiento",
  "listar_servicios",
  "consultar_disponibilidad",
  "crear_cita",
  "ver_citas_del_cliente",
  "cancelar_cita",
  "reprogramar_cita",
  "guardar_datos_contacto",
  "transferir_a_humano",
] as const;
export type SystemToolName = (typeof SYSTEM_TOOL_NAMES)[number];

/** Labels of the Herramientas tab. */
export const SYSTEM_TOOL_LABELS: Record<SystemToolName, string> = {
  buscar_conocimiento: "Buscar en el conocimiento",
  listar_servicios: "Ver los servicios",
  consultar_disponibilidad: "Consultar huecos libres",
  crear_cita: "Crear citas",
  ver_citas_del_cliente: "Ver las citas del cliente",
  cancelar_cita: "Cancelar citas",
  reprogramar_cita: "Cambiar citas de hora",
  guardar_datos_contacto: "Guardar los datos del cliente",
  transferir_a_humano: "Pasar a una persona",
};

/**
 * Always on, whatever the agent says: there is always a way to a person ([CUM-02], [TRA-09]), and the platform
 * rules tell the model to use it ([MOT-05]).
 */
export const ALWAYS_ENABLED_TOOLS: readonly SystemToolName[] = ["transferir_a_humano"];

/** Tools of a new agent. In phase 1 the agent only has the hand-off ([HER-10]). */
export const DEFAULT_SYSTEM_TOOLS: readonly SystemToolName[] = ["transferir_a_humano"];

export function isSystemToolName(value: string): value is SystemToolName {
  return (SYSTEM_TOOL_NAMES as readonly string[]).includes(value);
}
