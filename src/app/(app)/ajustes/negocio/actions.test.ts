// Server Actions of Ajustes › Negocio called directly, as an attacker could ([SEG-04], [PER-01]).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { session: { id: string }; user: { id: string } },
  storageDir: "",
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return { ...actual, getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)) };
});

import { db } from "@/db";
import { businessSettings } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createBusiness, createUser } from "@/test/factories";
import { removeLogoAction, saveBusinessProfileAction, uploadLogoAction } from "./actions";

state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-negocio-"));
afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));

const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};

function profileForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values = {
    name: "Barbería Centro",
    contactEmail: "hola@barberia.example",
    contactPhone: "",
    address: "",
    website: "",
    sector: "peluqueria",
    timezone: "Europe/Madrid",
    color: "#1e2a4a",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function logoForm(bytes: Uint8Array, name = "logo.png", type = "image/png"): FormData {
  const form = new FormData();
  // A copy backed by a plain ArrayBuffer, as the File constructor's types require.
  form.set("logo", new File([new Uint8Array(bytes)], name, { type }));
  return form;
}

const settings = async () => (await db.select().from(businessSettings))[0];

beforeEach(async () => {
  state.session = null;
  await createBusiness({ name: "Peluquería Prueba", color: "#3d6df2", logoFileKey: null });
});

describe("saveBusinessProfileAction [AJU-01] [AJU-15]", () => {
  it("saves for the owner and the admin", async () => {
    await signInAs("admin");
    expect(await saveBusinessProfileAction(undefined, profileForm())).toEqual({ ok: true, message: "Cambios guardados." });
    expect(await settings()).toMatchObject({ name: "Barbería Centro", color: "#1e2a4a" });
  });

  it("returns the errors next to each field and saves nothing", async () => {
    await signInAs("owner");
    const result = await saveBusinessProfileAction(undefined, profileForm({ name: "", color: "rojo" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["color", "name"]);
    expect((await settings()).name).toBe("Peluquería Prueba");
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s gets «no permission» and nothing changes [PER-03] [PER-04]", async (role) => {
    await signInAs(role);
    expect(await saveBusinessProfileAction(undefined, profileForm())).toEqual({
      ok: false,
      error: "No tienes permiso para hacer esto.",
    });
    expect((await settings()).name).toBe("Peluquería Prueba");
  });

  it("without a session asks to sign in again", async () => {
    const result = await saveBusinessProfileAction(undefined, profileForm());
    expect(result).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
  });
});

describe("uploadLogoAction / removeLogoAction [SEG-13]", () => {
  it("stores a real image and removes it", async () => {
    await signInAs("owner");
    const result = await uploadLogoAction(undefined, logoForm(PNG));
    expect(result.ok).toBe(true);
    expect((await settings()).logoFileKey).toMatch(/^logos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect((await removeLogoAction()).ok).toBe(true);
    expect((await settings()).logoFileKey).toBeNull();
  });

  it("refuses a disguised file and a missing file with a message next to the field", async () => {
    await signInAs("owner");
    const disguised = await uploadLogoAction(undefined, logoForm(new TextEncoder().encode("<svg onload=alert(1)>"), "logo.png"));
    expect(disguised.ok).toBe(false);
    if (!disguised.ok) expect(disguised.fieldErrors?.logo?.[0]).toMatch(/PNG, JPG o WebP/);
    const missing = await uploadLogoAction(undefined, new FormData());
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.fieldErrors?.logo?.[0]).toBe("Elige una imagen.");
    expect((await settings()).logoFileKey).toBeNull();
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot upload or remove the logo", async (role) => {
    await signInAs(role);
    expect((await uploadLogoAction(undefined, logoForm(PNG))).ok).toBe(false);
    expect((await removeLogoAction()).ok).toBe(false);
    expect((await settings()).logoFileKey).toBeNull();
  });
});
