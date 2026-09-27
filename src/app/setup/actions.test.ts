// Server Actions of /setup called directly, as an attacker could ([SEG-04]): session, owner role, rate limit and
// redirects. Better Auth, headers and redirect are replaced; the data layer and the database are real.
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeSession = { session: { id: string }; user: { id: string } };
const state = vi.hoisted(() => ({
  session: null as FakeSession | null,
  requestHeaders: new Headers(),
  signIn: vi.fn<(input: { body: { email: string; password: string }; headers: Headers }) => Promise<{ ok: boolean }>>(
    async () => ({ ok: true }),
  ),
}));
vi.mock("next/headers", () => ({ headers: async () => state.requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
// Uploaded logos stay in memory: tests never write into the project's data/uploads.
const stored = vi.hoisted(() => new Map<string, string>());
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  const memory = {
    kind: "disk" as const,
    put: async (key: string, data: Uint8Array, contentType: string) => {
      stored.set(key, contentType);
      return { key, size: data.byteLength };
    },
    get: async () => null,
    delete: async (key: string) => {
      stored.delete(key);
    },
    exists: async (key: string) => stored.has(key),
  };
  return { ...original, getFileStorage: () => memory };
});
vi.mock("@/server/auth", () => ({
  auth: {
    api: {
      getSession: async () => state.session,
      signInEmail: (input: { body: { email: string; password: string }; headers: Headers }) => state.signIn(input),
    },
  },
}));

import { db } from "@/db";
import {
  appKv,
  businessHours,
  businessSettings,
  closures,
  rateLimits,
  resources,
  resourceSchedules,
  serviceResources,
  services,
  user,
} from "@/db/schema";
import { ensureSettingsRows, loadBusinessSettings } from "@/data/settings";
import { createOwner, saveBusinessStep, saveHoursStep, skipSetupStep } from "@/data/setup";
import type { Actor } from "@/lib/permissions";
import { deleteUserAccount } from "@/server/accounts";
import { createUser, TEST_PASSWORD } from "@/test/factories";
import {
  createOwnerAction,
  finishSetupAction,
  saveBusinessAction,
  saveHoursAction,
  skipStepAction,
  testKeyAction,
} from "./actions";

const OWNER = { name: "Ana Dueña", email: "ana@example.com", password: TEST_PASSWORD };

function form(values: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

function signInAs(userId: string | null) {
  state.session = userId ? { session: { id: `s-${userId}` }, user: { id: userId } } : null;
}

async function resetInstallation() {
  for (const { id } of await db.select({ id: user.id }).from(user)) await deleteUserAccount(db, id);
  await db.delete(serviceResources);
  await db.delete(resourceSchedules);
  await db.delete(services);
  await db.delete(resources);
  await db.delete(businessHours);
  await db.delete(closures);
  await db.delete(appKv);
  await db.delete(rateLimits);
  await ensureSettingsRows();
  await db.update(businessSettings).set({ name: "", sector: null, logoFileKey: null, setupStep: 1, setupCompletedAt: null });
}

async function signedInOwner(): Promise<Actor> {
  const { userId } = await createOwner(OWNER);
  signInAs(userId);
  return { userId, role: "owner", name: OWNER.name, channelIds: null };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  state.signIn.mockClear();
  state.requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.9" });
  signInAs(null);
  await resetInstallation();
});

describe("createOwnerAction [ASI-02] [SEG-07]", () => {
  it("creates the owner, signs them in and goes to step 2", async () => {
    await expect(createOwnerAction(undefined, form({ ...OWNER, email: "Ana@Example.com" }))).rejects.toThrow("REDIRECT:/setup?paso=2");
    expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(state.signIn.mock.calls[0][0].body).toEqual({ email: "ana@example.com", password: TEST_PASSWORD });
    expect(await db.select({ email: user.email }).from(user)).toEqual([{ email: "ana@example.com" }]);
  });

  it("is refused once a user exists, without signing anyone in", async () => {
    await createOwner(OWNER);
    const result = await createOwnerAction(undefined, form({ name: "Intrusa", email: "intrusa@example.com", password: TEST_PASSWORD }));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/ya tiene propietario/) });
    expect(state.signIn).not.toHaveBeenCalled();
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("returns the field errors of invalid data", async () => {
    const result = await createOwnerAction(undefined, form({ name: "", email: "x", password: "corta" }));
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["email", "name", "password"]);
  });

  it("limits the attempts per IP", async () => {
    for (let i = 0; i < 10; i++) await createOwnerAction(undefined, form({ name: "", email: "x", password: "x" }));
    const result = await createOwnerAction(undefined, form(OWNER));
    expect(result).toEqual({ ok: false, error: "Demasiados intentos. Espera unos minutos." });
    expect(await db.select().from(user)).toHaveLength(0);
    // Another IP is not affected.
    state.requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.4" });
    await expect(createOwnerAction(undefined, form(OWNER))).rejects.toThrow("REDIRECT:/setup?paso=2");
  });

  it("on a published installation the form must bring the installation code (SETUP_TOKEN)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", "codigo-de-instalacion-de-prueba-1234");
    try {
      const wrong = await createOwnerAction(undefined, form({ ...OWNER, setupToken: "adivinado" }));
      expect(wrong).toMatchObject({ ok: false, fieldErrors: { setupToken: [expect.stringMatching(/código de instalación/i)] } });
      expect(await db.select().from(user)).toHaveLength(0);
      await expect(createOwnerAction(undefined, form({ ...OWNER, setupToken: "codigo-de-instalacion-de-prueba-1234" }))).rejects.toThrow(
        "REDIRECT:/setup?paso=2",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("if signing in fails, the account exists and the login page brings the owner back", async () => {
    state.signIn.mockRejectedValueOnce(new Error("sign-in failed"));
    await expect(createOwnerAction(undefined, form(OWNER))).rejects.toThrow("REDIRECT:/login?next=%2Fsetup");
    expect(await db.select().from(user)).toHaveLength(1);
  });
});

describe("later steps need the owner's session [ASI-11] [SEG-04]", () => {
  const business = { name: "Peluquería Aurora", sector: "peluqueria", color: "#3d6df2" };

  it("without a session nothing is saved", async () => {
    await createOwner(OWNER);
    expect(await saveBusinessAction(undefined, form(business))).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
    expect((await loadBusinessSettings()).name).toBe("");
  });

  it("another role gets «no permission» and nothing is saved", async () => {
    await createOwner(OWNER);
    const admin = await createUser("admin");
    signInAs(admin.userId);
    expect(await saveBusinessAction(undefined, form(business))).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await skipStepAction(4)).toMatchObject({ ok: false });
    expect(await finishSetupAction(undefined, form({ destination: "/bandeja" }))).toMatchObject({ ok: false });
    expect((await loadBusinessSettings()).name).toBe("");
  });

  it("the owner saves step 2 (with a logo file) and goes on to step 3", async () => {
    await signedInOwner();
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });
    const data = form(business);
    data.append("logo", new File([png], "logo.png", { type: "image/png" }));
    await expect(saveBusinessAction(undefined, data)).rejects.toThrow("REDIRECT:/setup?paso=3");
    expect(await loadBusinessSettings()).toMatchObject({ name: "Peluquería Aurora", sector: "peluqueria" });
    const { logoFileKey } = await loadBusinessSettings();
    expect(logoFileKey).toMatch(/^logos\//);
    expect(stored.get(logoFileKey ?? "")).toBe("image/png");
  });

  it("a logo that is not an image is refused next to its field", async () => {
    await signedInOwner();
    const data = form(business);
    data.append("logo", new File(["<svg onload=alert(1)>"], "logo.png", { type: "image/png" }));
    const result = await saveBusinessAction(undefined, data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors?.logo).toBeTruthy();
  });

  it("step 3 reads its JSON payload and rejects anything else", async () => {
    const owner = await signedInOwner();
    await saveBusinessStep(owner, business);
    expect(await saveHoursAction(undefined, form({ payload: "esto no es json" }))).toMatchObject({ ok: false });
    const payload = JSON.stringify({ timezone: "Europe/Madrid", hours: [{ weekday: 1, startMin: 540, endMin: 840 }], closures: [] });
    await expect(saveHoursAction(undefined, form({ payload }))).rejects.toThrow("REDIRECT:/setup?paso=4");
  });
});

describe("testKeyAction [ASI-07]", () => {
  it("returns what OpenRouter says in Spanish, never the key, and only to the owner", async () => {
    const owner = await signedInOwner();
    await saveBusinessStep(owner, { name: "Pelu", sector: "peluqueria", color: "#3d6df2" });
    await saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [], closures: [] });
    const fakeFetch = vi.fn(async () => Response.json({ data: { label: "Clave DominIA", limit: null, usage_monthly: 2 } }));
    vi.stubGlobal("fetch", fakeFetch);

    const result = await testKeyAction("sk-or-v1-secret-typed-1234");
    expect(result).toMatchObject({ ok: true, data: { valid: true, message: "Clave válida" } });
    expect(JSON.stringify(result)).not.toContain("secret-typed");
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    const admin = await createUser("admin");
    signInAs(admin.userId);
    expect(await testKeyAction("sk-or-v1-secret-typed-1234")).toMatchObject({ ok: false });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe("finishSetupAction [ASI-10]", () => {
  async function ownerAtLastStep() {
    const owner = await signedInOwner();
    await saveBusinessStep(owner, { name: "Pelu", sector: "peluqueria", color: "#3d6df2" });
    await saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [], closures: [] });
    for (const step of [4, 5, 6]) await skipSetupStep(owner, step);
  }

  it("saves the finishing date and goes to the inbox", async () => {
    await ownerAtLastStep();
    await expect(finishSetupAction(undefined, form({ destination: "/bandeja" }))).rejects.toThrow("REDIRECT:/bandeja");
    expect((await loadBusinessSettings()).setupCompletedAt).toBeInstanceOf(Date);
  });

  it("never opens an unknown address: an address that is not in the app goes to the inbox", async () => {
    await ownerAtLastStep();
    await expect(finishSetupAction(undefined, form({ destination: "https://evil.example/" }))).rejects.toThrow("REDIRECT:/bandeja");
    await resetInstallation();
    await ownerAtLastStep();
    await expect(finishSetupAction(undefined, form({ destination: "/canales/nuevo/telegram" }))).rejects.toThrow("REDIRECT:/bandeja");
  });

  it("links to the WhatsApp and email wizards: finishing saves the date and opens the chosen one", async () => {
    await ownerAtLastStep();
    await expect(finishSetupAction(undefined, form({ destination: "/canales/nuevo/whatsapp" }))).rejects.toThrow("REDIRECT:/canales/nuevo/whatsapp");
    expect((await loadBusinessSettings()).setupCompletedAt).toBeInstanceOf(Date);
    await resetInstallation();
    await ownerAtLastStep();
    await expect(finishSetupAction(undefined, form({ destination: "/canales/nuevo/correo" }))).rejects.toThrow("REDIRECT:/canales/nuevo/correo");
    expect((await loadBusinessSettings()).setupCompletedAt).toBeInstanceOf(Date);
  });

  it("the placeholder steps continue one by one; only steps 4–6 can be skipped", async () => {
    const owner = await signedInOwner();
    await saveBusinessStep(owner, { name: "Pelu", sector: "peluqueria", color: "#3d6df2" });
    expect(await skipStepAction(2)).toMatchObject({ ok: false });
    await saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [], closures: [] });
    await expect(skipStepAction(4)).rejects.toThrow("REDIRECT:/setup?paso=5");
  });
});
