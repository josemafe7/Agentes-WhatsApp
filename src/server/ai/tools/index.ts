// The system tools that already work, and which of them an agent gets ([AGE-08], [HER-10]). Each later phase adds
// its tool module to IMPLEMENTED (buscar_conocimiento in phase 4, the booking tools in phase 5…).
import "server-only";
import { ALWAYS_ENABLED_TOOLS, isSystemToolName, WITH_BOOKING_TOOLS, type SystemToolName } from "@/lib/agent-tools";
import { anotarPermisoAvisos } from "./anotar-permiso-avisos";
import { buscarConocimiento, buscarConocimientoInterno } from "./buscar-conocimiento";
import { cancelarCita } from "./cancelar-cita";
import { consultarDisponibilidad } from "./consultar-disponibilidad";
import { crearCita } from "./crear-cita";
import { darDeBaja } from "./dar-de-baja";
import { guardarDatosContacto } from "./guardar-datos-contacto";
import { listarServicios } from "./listar-servicios";
import { toToolDefinition } from "./registry";
import { reprogramarCita } from "./reprogramar-cita";
import { transferirAHumano } from "./transferir-a-humano";
import { verCitasDelCliente } from "./ver-citas-del-cliente";
import type { RegisteredTool } from "./types";

export {
  defineTool,
  executeToolCall,
  MAX_TOOL_RESULT_CHARS,
  skipToolCalls,
  toToolDefinition,
  UNKNOWN_TOOL_NAME,
  type SkippedToolCallsReason,
  type ToolCallOutcome,
} from "./registry";
export type { AgentTool, RegisteredTool, ToolCallRecord, ToolContext, ToolMode, ToolOutput } from "./types";
// Custom HTTP tools ([HER-11]): defined on screen and attached per agent, loaded for each run next to these.
export { loadAgentHttpTools } from "./http-tool-agent";
export type { HttpToolDeps } from "./http-tool";

const IMPLEMENTED: readonly RegisteredTool[] = [
  transferirAHumano,
  buscarConocimiento,
  // Phase 5 · Agenda ([HER-01]).
  listarServicios,
  consultarDisponibilidad,
  crearCita,
  verCitasDelCliente,
  cancelarCita,
  reprogramarCita,
  guardarDatosContacto,
  // Phase 12 · Permisos y bajas ([HER-15], [HER-16]).
  anotarPermisoAvisos,
  darDeBaja,
];

const BY_NAME: ReadonlyMap<string, RegisteredTool> = new Map(IMPLEMENTED.map((tool) => [tool.name, tool]));

/** Names of the system tools that work today (the rest show «Próximamente» in the editor). */
export function implementedSystemTools(): SystemToolName[] {
  return IMPLEMENTED.map((tool) => tool.name).filter(isSystemToolName);
}

/**
 * Tools an agent can use: the implemented ones it has enabled, plus those always on (the hand-off and the baja); with
 * «Crear citas» in a WhatsApp or Telegram conversation, «anotar el permiso de avisos» too ([HER-15]). `blocked` takes
 * some off for this turn (an email whose sender is not vouched for, [COR-25]).
 */
export function toolsForAgent(enabled: readonly string[], options: { channelKind?: string; blocked?: readonly string[] } = {}): Map<string, RegisteredTool> {
  const wanted = new Set<string>([...enabled, ...ALWAYS_ENABLED_TOOLS]);
  const withBookings = enabled.includes("crear_cita") && (options.channelKind === "whatsapp" || options.channelKind === "telegram");
  for (const name of WITH_BOOKING_TOOLS) if (withBookings) wanted.add(name);
  for (const name of options.blocked ?? []) wanted.delete(name);
  return new Map([...BY_NAME].filter(([name]) => wanted.has(name)));
}

/**
 * The tools of an internal agent ([INT-07]): the search in its knowledge and nothing else. No hand-off, bookings,
 * contact data or custom HTTP tools, whatever its row says.
 */
export function toolsForInternalAgent(): Map<string, RegisteredTool> {
  return new Map([[buscarConocimientoInterno.name, buscarConocimientoInterno]]);
}

/** The `tools` field of the chat request. */
export function toolDefinitions(tools: ReadonlyMap<string, RegisteredTool>) {
  return [...tools.values()].map(toToolDefinition);
}
