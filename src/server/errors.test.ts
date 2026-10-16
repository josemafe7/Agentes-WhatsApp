// parseInput: what every form and route of the app goes through before anything is saved ([SEG-05]).
// toActionFailure: what every Server Action does with an error ([SEG-14]).
import { DrizzleQueryError } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { NotFoundError, parseInput, toActionFailure, UNEXPECTED_ACTION_ERROR, ValidationError } from "./errors";

afterEach(() => {
  vi.restoreAllMocks();
});

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("It should have thrown.");
}

describe("toActionFailure [SEG-14]", () => {
  it("an expected error becomes a failure with its message for the person, and nothing is logged", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(toActionFailure(new NotFoundError("No se ha encontrado la conversación."))).toEqual({ ok: false, error: "No se ha encontrado la conversación." });
    expect(toActionFailure(new ValidationError(undefined, { name: ["Escribe un nombre."] }))).toMatchObject({ ok: false, fieldErrors: { name: ["Escribe un nombre."] } });
    expect(logged).not.toHaveBeenCalled();
  });

  it("an unexpected error is thrown again without what it carried: a failed query never reaches the log with its values", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const question = "¿Cuánto cobra Marta Ruiz? Su teléfono es el 600 111 222";
    const failed = new DrizzleQueryError('insert into "assistant_messages" ("chat_id", "content") values ($1, $2)', ["chat-1", question], new Error("connection lost"));

    const thrown = thrownBy(() => toActionFailure(failed));
    // What goes on (and Next.js writes to the server log) is another error, with nothing of the original.
    expect(thrown).not.toBe(failed);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(UNEXPECTED_ACTION_ERROR);
    expect((thrown as Error).cause).toBeUndefined();
    expect(JSON.stringify(thrown, Object.getOwnPropertyNames(thrown))).not.toMatch(/Marta|600 111 222|assistant_messages/);

    // What failed is logged here, the safe way: that it was the database, and where it came from.
    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(logged.mock.calls[0]).toHaveLength(1);
    expect(line).toMatch(/^\[accion\] Error inesperado: Error de la base de datos/);
    expect(line).toMatch(/errors\.test\.ts:\d+:\d+/);
    expect(line).not.toMatch(/Marta|600 111 222|assistant_messages|params|chat-1/);
  });

  it("any other unexpected error keeps only its redacted message", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const thrown = thrownBy(() => toActionFailure(new TypeError("fetch failed: Authorization: Bearer abc.def-123")));
    expect((thrown as Error).message).toBe(UNEXPECTED_ACTION_ERROR);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("fetch failed");
    expect(line).not.toContain("abc.def-123");
  });

  it("redirect() and notFound() of Next.js go on untouched, so a Server Action can still use them", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const signal of [thrownBy(() => redirect("/login")), thrownBy(() => notFound())]) {
      expect(thrownBy(() => toActionFailure(signal))).toBe(signal);
    }
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("parseInput [SEG-05]", () => {
  it("validates what was sent once it is storable: without NUL characters or half surrogate pairs; bytes and dates as they are", () => {
    const schema = z.object({ name: z.string().min(1), notes: z.array(z.string()), file: z.instanceof(Uint8Array), at: z.date() }).strict();
    const file = new Uint8Array([0, 1, 2]);
    const at = new Date("2026-09-27T10:00:00Z");
    const parsed = parseInput(schema, { name: "Ana\u0000 Gil", notes: ["Alérgica\u0000 al tinte\ud800"], file, at });
    expect(parsed).toEqual({ name: "Ana Gil", notes: ["Alérgica al tinte�"], file, at });
    expect(parsed.file).toBe(file);
  });

  it("a text made only of NUL characters is empty, and refused like one", () => {
    expect(() => parseInput(z.object({ name: z.string().min(1) }), { name: "\u0000\u0000" })).toThrow(ValidationError);
  });
});
