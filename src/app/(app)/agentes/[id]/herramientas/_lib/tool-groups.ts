// How the Herramientas tab groups the system tools ([AGE-08]): by what each one works with, read from its identifier. A
// tool this file does not know (one a later phase registers) goes to «Otras», so it shows up all the same. Pure.

/** The groups in the order of the tab. */
const TOOL_GROUPS = [
  { key: "knowledge", title: "Conocimiento" },
  { key: "agenda", title: "Agenda" },
  { key: "customers", title: "Clientes" },
  { key: "handoff", title: "Traspaso" },
  { key: "other", title: "Otras" },
] as const;

export type ToolGroupKey = (typeof TOOL_GROUPS)[number]["key"];

const GROUP_BY_TOOL = new Map<string, ToolGroupKey>([
  ["buscar_conocimiento", "knowledge"],
  ["listar_servicios", "agenda"],
  ["consultar_disponibilidad", "agenda"],
  ["crear_cita", "agenda"],
  ["ver_citas_del_cliente", "agenda"],
  ["cancelar_cita", "agenda"],
  ["reprogramar_cita", "agenda"],
  ["guardar_datos_contacto", "customers"],
  ["transferir_a_humano", "handoff"],
]);

export function toolGroupOf(toolName: string): ToolGroupKey {
  return GROUP_BY_TOOL.get(toolName) ?? "other";
}

export type ToolGroup<T> = { key: ToolGroupKey; title: string; tools: T[] };

/** The tools under their group: groups in the order of the tab, tools in the order given, empty groups left out. */
export function groupTools<T extends { name: string }>(tools: readonly T[]): ToolGroup<T>[] {
  return TOOL_GROUPS.map(({ key, title }) => ({ key, title, tools: tools.filter((tool) => toolGroupOf(tool.name) === key) })).filter((group) => group.tools.length > 0);
}
