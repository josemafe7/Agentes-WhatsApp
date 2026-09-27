// parseInput: what every form and route of the app goes through before anything is saved ([SEG-05]).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseInput, ValidationError } from "./errors";

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
