// The Herramientas tab ([AGE-08], [HER-01], [HER-10]): every system tool with its state, from the tool registry. A tool
// becomes switchable as soon as its phase registers it in src/server/ai/tools; the hand-off is always on. Pure.
import { ALWAYS_ENABLED_TOOLS, SYSTEM_TOOL_LABELS, SYSTEM_TOOL_NAMES, type SystemToolName } from "@/lib/agent-tools";

/** always = cannot be switched off; available = works today; soon = arrives with its phase («Próximamente»). */
export type ToolAvailability = "always" | "available" | "soon";

export type ToolRow = { name: SystemToolName; label: string; description: string; availability: ToolAvailability; enabled: boolean };

export const SYSTEM_TOOL_DESCRIPTIONS: Record<SystemToolName, string> = {
  buscar_conocimiento: "Busca en los documentos, webs y preguntas frecuentes del negocio para responder con datos reales.",
  listar_servicios: "Consulta los servicios, su duración y su precio orientativo.",
  consultar_disponibilidad: "Mira los huecos libres reales de la agenda.",
  crear_cita: "Reserva una cita después de confirmarla con el cliente.",
  ver_citas_del_cliente: "Consulta las citas del cliente de la conversación, nunca las de otros.",
  cancelar_cita: "Cancela una cita del cliente de la conversación, con su confirmación.",
  reprogramar_cita: "Cambia de hora una cita del cliente, comprobando que el nuevo hueco sigue libre.",
  guardar_datos_contacto: "Guarda el nombre, el teléfono, el email y notas en la ficha del cliente.",
  transferir_a_humano: "Pasa la conversación a una persona del equipo con el motivo, un resumen y la urgencia.",
};

/** Rows of the tab, in the order of [HER-01]. */
export function toolRows(enabled: readonly string[], implemented: readonly string[]): ToolRow[] {
  return SYSTEM_TOOL_NAMES.map((name) => {
    const availability: ToolAvailability = ALWAYS_ENABLED_TOOLS.includes(name) ? "always" : implemented.includes(name) ? "available" : "soon";
    return {
      name,
      label: SYSTEM_TOOL_LABELS[name],
      description: SYSTEM_TOOL_DESCRIPTIONS[name],
      availability,
      enabled: availability === "always" || enabled.includes(name),
    };
  });
}
