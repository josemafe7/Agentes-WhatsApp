import { describe, expect, it } from "vitest";
import { agentInitials, EDITOR_TABS, hasEditorTab, INSTRUCTION_FIELDS, instructionFieldsFor } from "./labels";

describe("initials of an agent without avatar [AGE-01]", () => {
  it("take the first two words that say something, skipping «de», «del», «la»…", () => {
    expect(agentInitials("Recepción Ana")).toBe("RA");
    expect(agentInitials("Recepción del taller")).toBe("RT");
    expect(agentInitials("Asistente de citas")).toBe("AC");
    expect(agentInitials("Asistente de la clínica dental")).toBe("AC");
    expect(agentInitials("ávila")).toBe("Á");
  });

  it("keep something readable for names made only of short words, symbols or nothing", () => {
    expect(agentInitials("De la")).toBe("DL");
    expect(agentInitials("«Recepción» 24h")).toBe("R2");
    expect(agentInitials("   ")).toBe("·");
  });
});

describe("the editor of an internal agent [INT-02]", () => {
  const tabsOf = (audience: "customers" | "team") => EDITOR_TABS.filter((tab) => hasEditorTab(audience, tab.key)).map((tab) => tab.label);

  it("has General, Instrucciones, Modelo, Conocimiento, Acceso, Probar and Versiones: no Herramientas, Traspaso or Canales", () => {
    expect(tabsOf("team")).toEqual(["General", "Instrucciones", "Modelo", "Conocimiento", "Acceso", "Probar", "Versiones"]);
  });

  it("an agent for customers keeps its nine tabs, without Acceso [AGE-03]", () => {
    expect(tabsOf("customers")).toEqual(["General", "Instrucciones", "Modelo", "Conocimiento", "Herramientas", "Traspaso", "Canales", "Probar", "Versiones"]);
  });

  it("its guided instructions have no «Cuándo pasar a una persona», and speak of the team", () => {
    const team = instructionFieldsFor("team");
    expect(team.map((field) => field.key)).toEqual(["role", "businessInfo", "can", "cannot", "style", "freeText"]);
    expect(team.find((field) => field.key === "role")?.help).toContain("equipo");
    expect(team.map((field) => field.help).join(" ")).not.toContain("clientes");
    expect(instructionFieldsFor("customers").map((field) => field.key)).toEqual(INSTRUCTION_FIELDS.map((field) => field.key));
  });
});
