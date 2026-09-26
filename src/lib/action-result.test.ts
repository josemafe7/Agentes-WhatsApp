import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fail, fromZodError, ok, type ActionResult } from "./action-result";

describe("ActionResult helpers", () => {
  it("ok() carries optional data and message", () => {
    expect(ok()).toEqual({ ok: true });
    expect(ok({ id: "a" }, "Guardado")).toEqual({ ok: true, data: { id: "a" }, message: "Guardado" });
    expect(ok(undefined, "Guardado")).toEqual({ ok: true, message: "Guardado" });
  });

  it("fail() carries a generic error and optional field errors", () => {
    expect(fail("No se ha podido guardar")).toEqual({ ok: false, error: "No se ha podido guardar" });
    expect(fail("Revisa los campos", { name: ["Obligatorio"] })).toEqual({
      ok: false,
      error: "Revisa los campos",
      fieldErrors: { name: ["Obligatorio"] },
    });
  });

  it("[SEG-05] fromZodError() maps every invalid field and keeps a generic message", () => {
    const schema = z.object({
      name: z.string().min(1, "Escribe un nombre"),
      email: z.email("Email no válido"),
    });
    const parsed = schema.safeParse({ name: "", email: "x" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const result = fromZodError(parsed.error);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Revisa los campos marcados.");
    expect(result.fieldErrors).toEqual({ name: ["Escribe un nombre"], email: ["Email no válido"] });
  });

  it("fromZodError() accepts a custom message", () => {
    const parsed = z.string().safeParse(1);
    if (parsed.success) throw new Error("expected failure");
    expect(fromZodError(parsed.error, "Datos no válidos").error).toBe("Datos no válidos");
  });

  it("narrows by ok", () => {
    const result: ActionResult<number> = ok(3);
    if (result.ok) expect(result.data).toBe(3);
  });
});
