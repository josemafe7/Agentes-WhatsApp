import { describe, expect, it } from "vitest";
import { SYSTEM_TOOL_NAMES } from "@/lib/agent-tools";
import { groupTools, toolGroupOf } from "./tool-groups";

const named = (names: readonly string[]) => names.map((name) => ({ name }));

describe("Grupos de la pestaña Herramientas [AGE-08]", () => {
  it("puts each system tool under its theme, in the order of the tab and keeping the order of the tools", () => {
    expect(groupTools(named(SYSTEM_TOOL_NAMES)).map((group) => [group.title, group.tools.map((tool) => tool.name)])).toEqual([
      ["Conocimiento", ["buscar_conocimiento"]],
      ["Agenda", ["listar_servicios", "consultar_disponibilidad", "crear_cita", "ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita"]],
      ["Clientes", ["guardar_datos_contacto"]],
      ["Traspaso", ["transferir_a_humano"]],
    ]);
  });

  it("knows every system tool of today: none falls into «Otras»", () => {
    for (const name of SYSTEM_TOOL_NAMES) expect(toolGroupOf(name), name).not.toBe("other");
  });

  it("sends a tool it does not know to a last group «Otras», so it still shows up", () => {
    const groups = groupTools(named(["herramienta_nueva", "transferir_a_humano", "crear_cita", "toString"]));
    expect(groups.map((group) => [group.key, group.title, group.tools.map((tool) => tool.name)])).toEqual([
      ["agenda", "Agenda", ["crear_cita"]],
      ["handoff", "Traspaso", ["transferir_a_humano"]],
      ["other", "Otras", ["herramienta_nueva", "toString"]],
    ]);
  });

  it("keeps each tool as it came and leaves out the groups without tools", () => {
    const search = { name: "buscar_conocimiento", label: "Buscar en el conocimiento", enabled: true };
    expect(groupTools([search])).toEqual([{ key: "knowledge", title: "Conocimiento", tools: [search] }]);
    expect(groupTools([])).toEqual([]);
  });
});
