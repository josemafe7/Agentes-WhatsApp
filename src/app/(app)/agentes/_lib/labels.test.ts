import { describe, expect, it } from "vitest";
import { agentInitials } from "./labels";

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
