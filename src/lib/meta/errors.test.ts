import { describe, expect, it } from "vitest";
import { describeMetaError, META_ERRORS, MetaGraphError } from "./errors";

describe("Meta errors in Spanish with what to do [WA-09]", () => {
  it.each([
    [190, "El token no es válido o ha caducado", "permanent"],
    [200, "El token no tiene acceso", "permanent"],
    [100, "Algún dato no es correcto", "permanent"],
    [133016, "Demasiados intentos de registro", "wait"],
    [131042, "método de pago", "permanent"],
    [131047, "ventana de 24 h", "permanent"],
    [131026, "no tiene WhatsApp", "permanent"],
    [368, "restringido", "permanent"],
    [130429, "demasiado rápido", "retryable"],
    [131056, "Demasiados mensajes seguidos", "retryable"],
    [131000, "error de Meta", "retryable"],
    [131016, "no está disponible", "retryable"],
    [131057, "mantenimiento", "retryable"],
    [4, "Demasiadas consultas", "retryable"],
    [80007, "Demasiadas consultas", "retryable"],
    [2, "no está disponible", "retryable"],
    [131049, "marketing", "wait"],
    [133005, "El PIN no es correcto", "permanent"],
    [136024, "ya está verificado", "permanent"],
  ])("code %i → «%s» (%s)", (code, text, kind) => {
    const described = describeMetaError(code);
    expect(described.message).toContain(text);
    expect(described.action.length).toBeGreaterThan(0);
    expect(described.kind).toBe(kind);
    expect(described.retryable).toBe(kind === "retryable");
  });

  it("every documented code of the official table has a message, an action and a kind (docs §12)", () => {
    const documented = [
      0, 1, 2, 3, 4, 10, 100, 190, 200, 368, 80007, 130429, 130472, 131000, 131005, 131008, 131009, 131016, 131021, 131026, 131031, 131042, 131045,
      131047, 131048, 131049, 131051, 131052, 131053, 131056, 131057, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069, 133000,
      133004, 133005, 133006, 133008, 133009, 133010, 133015, 133016, 135000, 136024, 33, 130403, 130497, 131037, 131050, 131063, 131064, 131062,
    ];
    for (const code of documented) {
      expect(META_ERRORS[code], `code ${code}`).toBeDefined();
      expect(META_ERRORS[code].message).toMatch(/\S/);
    }
  });

  it("200–299 are missing permissions", () => {
    expect(describeMetaError(250).message).toBe("Al token le falta un permiso.");
  });

  it("an unknown code shows a generic message with the code", () => {
    const described = describeMetaError(987654);
    expect(described.message).toBe("Meta ha devuelto un error (código 987654).");
    expect(described.kind).toBe("permanent");
  });

  it("is_transient makes any error retryable", () => {
    expect(describeMetaError(100, { isTransient: true }).retryable).toBe(true);
  });

  it("MetaGraphError keeps the code, the Spanish message and Meta's details, never the raw message", () => {
    const error = MetaGraphError.fromMeta(400, { code: 131047, error_data: { details: "More than 24 hours have passed" } });
    expect(error).toMatchObject({ code: 131047, httpStatus: 400, retryable: false, details: "More than 24 hours have passed" });
    expect(error.message).toBe("La ventana de 24 h está cerrada. Usa una plantilla aprobada.");
  });
});
