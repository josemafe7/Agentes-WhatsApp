import { describe, expect, it } from "vitest";
import { SYSTEM_TOOL_NAMES } from "@/lib/agent-tools";
import { toolRows } from "./tools";

describe("Herramientas del agente [AGE-08] [HER-10]", () => {
  it("lists every system tool; in phase 1 only the hand-off works and it is always on", () => {
    const rows = toolRows([], ["transferir_a_humano"]);
    expect(rows.map((row) => row.name)).toEqual([...SYSTEM_TOOL_NAMES]);
    const handoff = rows.find((row) => row.name === "transferir_a_humano");
    expect(handoff).toMatchObject({ availability: "always", enabled: true, label: "Pasar a una persona" });
    // «Dar de baja» is always on as well ([HER-16]); «anotar el permiso de avisos» goes with «Crear citas» ([HER-15]).
    expect(rows.find((row) => row.name === "dar_de_baja")).toMatchObject({ availability: "always", enabled: true });
    expect(rows.find((row) => row.name === "anotar_permiso_avisos")).toMatchObject({ availability: "with_bookings", enabled: false });
    expect(rows.filter((row) => row.availability === "soon")).toHaveLength(SYSTEM_TOOL_NAMES.length - 3);
  });

  it("a tool registered by a later phase becomes switchable, and shows whether the agent has it on", () => {
    const rows = toolRows(["buscar_conocimiento"], ["transferir_a_humano", "buscar_conocimiento", "crear_cita"]);
    expect(rows.find((row) => row.name === "buscar_conocimiento")).toMatchObject({ availability: "available", enabled: true });
    expect(rows.find((row) => row.name === "crear_cita")).toMatchObject({ availability: "available", enabled: false });
    expect(rows.find((row) => row.name === "cancelar_cita")).toMatchObject({ availability: "soon", enabled: false });
  });
});
