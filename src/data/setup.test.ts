// Setup wizard data layer ([ASI-01]–[ASI-11]). Each test starts from an empty installation (resetInstallation).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  appKv,
  auditLog,
  businessHours,
  businessSettings,
  closures,
  integrationSettings,
  resources,
  resourceSchedules,
  resourceTimeOff,
  serviceResources,
  services,
  user,
  userRoles,
} from "@/db/schema";
import { SECTORS, type Role } from "@/lib/enums";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { deleteUserAccount } from "@/server/accounts";
import type { FileStorage } from "@/server/adapters/file-storage";
import { AuthError, ConflictError, ValidationError } from "@/server/errors";
import { actorFor, TEST_PASSWORD } from "@/test/factories";
import { fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { MAX_LOGO_BYTES } from "./business";
import { ensureSettingsRows, getOpenRouterKey, loadBusinessSettings, loadIntegrationSettings } from "./settings";
import {
  createOwner,
  finishSetup,
  getAiStepData,
  getBusinessStepData,
  getHoursStepData,
  getSetupSectorTemplate,
  getSetupStatus,
  saveAiStep,
  saveBusinessStep,
  saveHoursStep,
  setupTokenState,
  skipSetupStep,
  testSetupOpenRouterKey,
} from "./setup";

const OWNER_INPUT = { name: "Ana Dueña", email: "Ana@Example.com", password: TEST_PASSWORD };
const NOT_OWNER: Role[] = ["admin", "supervisor", "agent", "viewer"];
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

async function resetInstallation() {
  for (const { id } of await db.select({ id: user.id }).from(user)) await deleteUserAccount(db, id);
  await db.delete(serviceResources);
  await db.delete(resourceSchedules);
  await db.delete(resourceTimeOff);
  await db.delete(services);
  await db.delete(resources);
  await db.delete(businessHours);
  await db.delete(closures);
  await db.delete(appKv);
  await db.delete(auditLog);
  await ensureSettingsRows();
  await db.update(businessSettings).set({
    name: "",
    sector: null,
    color: "#3d6df2",
    logoFileKey: null,
    timezone: "Europe/Madrid",
    terminology: {},
    agendaMode: "individual",
    setupStep: 1,
    setupCompletedAt: null,
  });
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, defaultModels: {}, recommendedModels: [] });
}

/** Creates the owner through step 1 and returns their actor. */
async function ownerActor(): Promise<Actor> {
  const { userId } = await createOwner(OWNER_INPUT);
  return { userId, role: "owner", name: OWNER_INPUT.name, channelIds: null };
}

function memoryStorage() {
  const files = new Map<string, { data: Uint8Array; contentType: string }>();
  const storage: FileStorage = {
    kind: "disk",
    put: async (key, data, contentType) => {
      files.set(key, { data, contentType });
      return { key, size: data.byteLength };
    },
    get: async () => null,
    delete: async (key) => {
      files.delete(key);
    },
    exists: async (key) => files.has(key),
  };
  return { storage, files };
}

const BUSINESS = { name: "Peluquería Aurora", sector: "peluqueria", color: "#3D6DF2" } as const;

/** OpenRouter's model list (fake fetch, one model of each exclusion), for the check of the chat model in step 4. */
function catalogFetch() {
  return fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
}

/** Owner with steps 2 and 3 done (the first pending step is 4). */
async function ownerAtAiStep(): Promise<Actor> {
  const owner = await ownerActor();
  await saveBusinessStep(owner, BUSINESS);
  await saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [{ weekday: 1, startMin: 540, endMin: 840 }], closures: [] });
  return owner;
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  await resetInstallation();
});

describe("step 1 · owner [ASI-01] [ASI-02]", () => {
  it("an empty installation starts at step 1", async () => {
    expect(await getSetupStatus()).toEqual({ hasUsers: false, completed: false, currentStep: 1 });
  });

  it("creates the owner (email in lower case) and moves on to step 2", async () => {
    const { userId, email } = await createOwner(OWNER_INPUT);
    expect(email).toBe("ana@example.com");
    const roles = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    expect(roles.map((r) => r.role)).toEqual(["owner"]);
    expect(await getSetupStatus()).toEqual({ hasUsers: true, completed: false, currentStep: 2 });
    const log = await db.select().from(auditLog);
    expect(log.map((e) => e.action)).toContain("setup.owner_created");
    expect(JSON.stringify(log)).not.toContain(TEST_PASSWORD);
  });

  it("a second attempt is rejected once a user exists, and creates nobody [USU-04]", async () => {
    await createOwner(OWNER_INPUT);
    await expect(createOwner({ name: "Intrusa", email: "otra@example.com", password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const users = await db.select({ email: user.email }).from(user);
    expect(users).toEqual([{ email: "ana@example.com" }]);
  });

  it("if two people try at once, only one becomes owner", async () => {
    const results = await Promise.allSettled([
      createOwner({ name: "Ana", email: "ana@example.com", password: TEST_PASSWORD }),
      createOwner({ name: "Bea", email: "bea@example.com", password: TEST_PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("rejects invalid data with a message per field and creates nobody", async () => {
    const error = await createOwner({ name: "", email: "no-es-un-email", password: "corta" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {}).sort()).toEqual(["email", "name", "password"]);
    expect(await db.select().from(user)).toHaveLength(0);
  });
});

describe("step 1 on a published installation needs the installation code [ASI-02] [SEG-04]", () => {
  const CODE = "codigo-de-instalacion-largo-y-al-azar-0123456789";

  it("local development needs no code", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SETUP_TOKEN", "");
    expect(setupTokenState()).toBe("not_needed");
    await expect(createOwner(OWNER_INPUT)).resolves.toMatchObject({ email: "ana@example.com" });
  });

  it("in production without SETUP_TOKEN nobody can become the owner, and the reason is explained", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", "");
    expect(setupTokenState()).toBe("missing");
    const error = await createOwner({ ...OWNER_INPUT, setupToken: "lo-que-sea" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toMatch(/SETUP_TOKEN/);
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("with SETUP_TOKEN, a missing or wrong code is refused next to its field and creates nobody", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", CODE);
    expect(setupTokenState()).toBe("required");
    for (const setupToken of [undefined, "", "codigo-equivocado", `${CODE}x`]) {
      const error = await createOwner({ ...OWNER_INPUT, setupToken }).catch((e: unknown) => e);
      expect(error, String(setupToken)).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors?.setupToken?.[0]).toMatch(/código de instalación/i);
    }
    expect(await db.select().from(user)).toHaveLength(0);
    await expect(createOwner({ ...OWNER_INPUT, setupToken: ` ${CODE} ` })).resolves.toMatchObject({ email: "ana@example.com" });
    expect(await getSetupStatus()).toMatchObject({ hasUsers: true, currentStep: 2 });
  });
});

describe("only the owner continues the wizard [ASI-11]", () => {
  it.each(NOT_OWNER)("%s cannot run or read any step, and nothing changes", async (role) => {
    await ownerActor();
    const other = actorFor(role);
    await expect(saveBusinessStep(other, BUSINESS)).rejects.toBeInstanceOf(AuthError);
    await expect(saveHoursStep(other, { timezone: "Europe/Madrid", hours: [], closures: [] })).rejects.toBeInstanceOf(AuthError);
    await expect(saveAiStep(other, { chatModel: DEFAULT_MODELS.chat })).rejects.toBeInstanceOf(AuthError);
    await expect(testSetupOpenRouterKey(other, { key: "sk-or-v1-x" })).rejects.toBeInstanceOf(AuthError);
    await expect(skipSetupStep(other, 4)).rejects.toBeInstanceOf(AuthError);
    await expect(finishSetup(other)).rejects.toBeInstanceOf(AuthError);
    await expect(getBusinessStepData(other)).rejects.toBeInstanceOf(AuthError);
    await expect(getHoursStepData(other)).rejects.toBeInstanceOf(AuthError);
    await expect(getAiStepData(other)).rejects.toBeInstanceOf(AuthError);
    const settings = await loadBusinessSettings();
    expect(settings).toMatchObject({ name: "", sector: null, setupStep: 2, setupCompletedAt: null });
    expect(await db.select().from(services)).toHaveLength(0);
  });

  it("steps cannot be skipped ahead: each one needs the previous ones done", async () => {
    const owner = await ownerActor();
    await expect(saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [], closures: [] })).rejects.toBeInstanceOf(ConflictError);
    await expect(saveAiStep(owner, { chatModel: DEFAULT_MODELS.chat })).rejects.toBeInstanceOf(ConflictError);
    await expect(skipSetupStep(owner, 5)).rejects.toBeInstanceOf(ConflictError);
    await expect(finishSetup(owner)).rejects.toBeInstanceOf(ConflictError);
    await expect(skipSetupStep(owner, 2)).rejects.toBeInstanceOf(ValidationError);
    expect((await getSetupStatus()).currentStep).toBe(2);
  });

  it("progress is kept on the server: going back to edit a step does not lose later progress", async () => {
    const owner = await ownerAtAiStep();
    expect((await getSetupStatus()).currentStep).toBe(4);
    await saveBusinessStep(owner, { ...BUSINESS, name: "Peluquería Aurora Centro" });
    expect((await getSetupStatus()).currentStep).toBe(4);
    expect((await getBusinessStepData(owner)).name).toBe("Peluquería Aurora Centro");
  });
});

describe("step 2 · business and sector [ASI-03] [ASI-04]", () => {
  it("saves name and colour and loads the sector preset: words, agenda mode, services and resources", async () => {
    const owner = await ownerActor();
    await saveBusinessStep(owner, BUSINESS);
    const preset = getSectorPreset("peluqueria");

    const settings = await loadBusinessSettings();
    expect(settings).toMatchObject({ name: "Peluquería Aurora", color: "#3d6df2", sector: "peluqueria", setupStep: 3 });
    expect(settings.terminology).toEqual(preset.terminology);
    expect(settings.agendaMode).toBe(preset.agendaMode);
    const serviceRows = await db.select().from(services);
    expect(serviceRows.map((s) => s.name).sort()).toEqual(preset.services.map((s) => s.name).sort());
    const resourceRows = await db.select().from(resources);
    expect(resourceRows.map((r) => r.name).sort()).toEqual(preset.resources.map((r) => r.name).sort());
    const scheduled = preset.resources.reduce((total, r) => total + r.schedule.length, 0);
    expect(await db.select().from(resourceSchedules)).toHaveLength(scheduled);
    expect((await db.select().from(serviceResources)).length).toBeGreaterThan(0);

    expect(settings.slotIntervalMin).toBe(preset.slotIntervalMin);

    // The sector's suggested opening hours are the starting point of step 3.
    const byDayAndStart = (a: { weekday: number; startMin: number }, b: { weekday: number; startMin: number }) =>
      a.weekday - b.weekday || a.startMin - b.startMin;
    expect((await getHoursStepData(owner)).hours).toEqual([...preset.businessHours].sort(byDayAndStart));

    const template = await getSetupSectorTemplate(owner);
    expect(template).toEqual({ sector: "peluqueria", agentTemplate: preset.agentTemplate, faqs: preset.faqs });
  });

  it("changing the sector after saving the hours keeps the owner's hours", async () => {
    const owner = await ownerAtAiStep();
    await saveBusinessStep(owner, { ...BUSINESS, sector: "taller" });
    expect((await getHoursStepData(owner)).hours).toEqual([{ weekday: 1, startMin: 540, endMin: 840 }]);
    expect((await db.select().from(services)).map((s) => s.name).sort()).toEqual(
      getSectorPreset("taller").services.map((s) => s.name).sort(),
    );
  });

  it.each(SECTORS)("every sector can be chosen: %s [AGD-27]", async (sector) => {
    const owner = await ownerActor();
    await saveBusinessStep(owner, { ...BUSINESS, sector });
    const preset = getSectorPreset(sector);
    expect(await db.select().from(services)).toHaveLength(preset.services.length);
    expect(await db.select().from(resources)).toHaveLength(preset.resources.length);
    expect((await loadBusinessSettings()).agendaMode).toBe(preset.agendaMode);
  });

  it("Inmobiliaria and Tienda use the agenda of «Otro» [ASI-04]", async () => {
    expect(getSectorPreset("inmobiliaria").agendaMode).toBe(getSectorPreset("otro").agendaMode);
    expect(getSectorPreset("tienda").agendaMode).toBe(getSectorPreset("otro").agendaMode);
  });

  it("saving again with the same sector keeps the data (no duplicates); another sector replaces what the wizard loaded [AGD-27]", async () => {
    const owner = await ownerActor();
    await saveBusinessStep(owner, BUSINESS);
    const [first] = await db.select().from(services);
    await db.update(services).set({ name: "Corte editado" }).where(eq(services.id, first.id));
    await saveBusinessStep(owner, BUSINESS);
    expect(await db.select().from(services)).toHaveLength(getSectorPreset("peluqueria").services.length);
    expect((await db.select().from(services)).map((s) => s.name)).toContain("Corte editado");

    await saveBusinessStep(owner, { ...BUSINESS, sector: "restaurante" });
    const restaurant = getSectorPreset("restaurante");
    expect((await db.select().from(services)).map((s) => s.name).sort()).toEqual(restaurant.services.map((s) => s.name).sort());
    expect((await db.select().from(resources)).map((r) => r.name).sort()).toEqual(restaurant.resources.map((r) => r.name).sort());
    expect((await loadBusinessSettings()).terminology).toEqual(restaurant.terminology);
    expect((await getSetupSectorTemplate(owner))?.sector).toBe("restaurante");
  });

  it("rejects invalid values with a message per field and saves nothing", async () => {
    const owner = await ownerActor();
    const error = await saveBusinessStep(owner, { name: " ", sector: "astronautas", color: "azul" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {}).sort()).toEqual(["color", "name", "sector"]);
    expect((await loadBusinessSettings()).name).toBe("");
    expect(await db.select().from(services)).toHaveLength(0);
  });

  it("stores a PNG logo under a generated key; other files or too big ones are rejected", async () => {
    const owner = await ownerActor();
    const { storage, files } = memoryStorage();
    await saveBusinessStep(owner, BUSINESS, { bytes: PNG_BYTES }, { storage });
    const { logoFileKey } = await loadBusinessSettings();
    expect(logoFileKey).toMatch(/^logos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(files.get(logoFileKey ?? "")?.contentType).toBe("image/png");

    const html = new TextEncoder().encode("<svg onload=alert(1)>");
    await expect(saveBusinessStep(owner, BUSINESS, { bytes: html }, { storage })).rejects.toBeInstanceOf(ValidationError);
    const huge = new Uint8Array(MAX_LOGO_BYTES + 1);
    huge.set(PNG_BYTES);
    await expect(saveBusinessStep(owner, BUSINESS, { bytes: huge }, { storage })).rejects.toBeInstanceOf(ValidationError);
    expect([...files.keys()]).toEqual([logoFileKey]);
    expect((await loadBusinessSettings()).logoFileKey).toBe(logoFileKey);

    // An empty file input (no logo chosen) keeps the current logo.
    await saveBusinessStep(owner, BUSINESS, { bytes: new Uint8Array() }, { storage });
    expect((await loadBusinessSettings()).logoFileKey).toBe(logoFileKey);
  });
});

describe("step 3 · hours, closures and time zone [ASI-06]", () => {
  const input = {
    timezone: "Atlantic/Canary",
    hours: [
      { weekday: 1, startMin: 9 * 60, endMin: 14 * 60 },
      { weekday: 1, startMin: 16 * 60, endMin: 20 * 60 },
      { weekday: 6, startMin: 10 * 60, endMin: 14 * 60 },
    ],
    closures: [
      { startDate: "2026-12-24", endDate: "2026-12-26", reason: "Navidad" },
      { startDate: "2027-01-06", endDate: "2027-01-06", reason: "" },
    ],
  };

  it("saves several ranges per day, closures and the time zone, and moves on to step 4", async () => {
    const owner = await ownerActor();
    await saveBusinessStep(owner, BUSINESS);
    await saveHoursStep(owner, input);
    const data = await getHoursStepData(owner);
    expect(data.timezone).toBe("Atlantic/Canary");
    expect(data.hours).toEqual(input.hours);
    expect(data.closures).toEqual([
      { startDate: "2026-12-24", endDate: "2026-12-26", reason: "Navidad" },
      { startDate: "2027-01-06", endDate: "2027-01-06", reason: null },
    ]);
    expect((await getSetupStatus()).currentStep).toBe(4);

    // Saving again replaces the previous week and closures.
    await saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [{ weekday: 2, startMin: 600, endMin: 1200 }], closures: [] });
    expect(await getHoursStepData(owner)).toEqual({
      timezone: "Europe/Madrid",
      hours: [{ weekday: 2, startMin: 600, endMin: 1200 }],
      closures: [],
    });
  });

  it.each([
    ["overlapping ranges", { hours: [{ weekday: 1, startMin: 540, endMin: 840 }, { weekday: 1, startMin: 800, endMin: 900 }] }, "hours"],
    ["a range that ends before it starts", { hours: [{ weekday: 3, startMin: 900, endMin: 600 }] }, "hours"],
    ["an invalid weekday", { hours: [{ weekday: 8, startMin: 600, endMin: 700 }] }, "hours"],
    ["an unknown time zone", { timezone: "Marte/Olympus" }, "timezone"],
    ["a closure that ends before it starts", { closures: [{ startDate: "2026-12-26", endDate: "2026-12-24" }] }, "closures"],
    ["an impossible date", { closures: [{ startDate: "2026-02-30", endDate: "2026-02-30" }] }, "closures"],
  ])("rejects %s and changes nothing", async (_case, override, field) => {
    const owner = await ownerActor();
    await saveBusinessStep(owner, BUSINESS);
    const before = await getHoursStepData(owner);
    const error = await saveHoursStep(owner, { ...input, ...override }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toContain(field);
    expect(await getHoursStepData(owner)).toEqual(before);
    expect((await getSetupStatus()).currentStep).toBe(3);
  });
});

describe("step 4 · OpenRouter key and model [ASI-07] [ARR-14]", () => {
  it("saves the key encrypted, the chat model and the other default models", async () => {
    const owner = await ownerAtAiStep();
    await saveAiStep(owner, { openrouterKey: "sk-or-v1-wizard-key-4321", chatModel: "google/gemini-3.1-flash-lite" }, { fetchImpl: catalogFetch().fetch });
    const settings = await loadIntegrationSettings();
    expect(settings.openrouterKeyEnc).toMatch(/^v1:/);
    expect(JSON.stringify(settings)).not.toContain("wizard-key");
    expect(await getOpenRouterKey()).toBe("sk-or-v1-wizard-key-4321");
    // The default fallback (Google) would be of the same provider as this chat model: another one is kept [MOD-05].
    expect(settings.defaultModels).toEqual({ ...DEFAULT_MODELS, chat: "google/gemini-3.1-flash-lite", fallback: DEFAULT_MODELS.chat });
    expect(settings.recommendedModels.length).toBeGreaterThan(0);
    expect((await getSetupStatus()).currentStep).toBe(5);

    const view = await getAiStepData(owner);
    expect(view.openrouterKey).toMatchObject({ configured: true, masked: "••••4321" });
    expect(JSON.stringify(view)).not.toContain("wizard-key");
  });

  it("an empty key keeps the saved one; an invalid model is rejected", async () => {
    const owner = await ownerAtAiStep();
    const { fetch } = catalogFetch();
    await saveAiStep(owner, { openrouterKey: "sk-or-v1-first-1111", chatModel: DEFAULT_MODELS.chat }, { fetchImpl: fetch });
    await saveAiStep(owner, { openrouterKey: "", chatModel: DEFAULT_MODELS.chat }, { fetchImpl: fetch });
    expect(await getOpenRouterKey()).toBe("sk-or-v1-first-1111");
    await expect(saveAiStep(owner, { chatModel: "un modelo cualquiera" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the chat model is checked like an agent's: free, tool-less, retiring or unknown ones are refused and nothing is saved [MOD-02] [MOD-05]", async () => {
    const owner = await ownerAtAiStep();
    const fake = catalogFetch();
    const refused = [
      ["qwen/qwen3.8-27b:free", /gratuitos/],
      ["meta/llama-no-tools", /herramientas/],
      ["deepseek/deepseek-v3.2", /se retira/],
      ["no-existe/modelo", /no está en la lista/],
    ] as const;
    for (const [chatModel, message] of refused) {
      const error = await saveAiStep(owner, { openrouterKey: "sk-or-v1-typed-9999", chatModel }, { fetchImpl: fake.fetch }).catch((caught: unknown) => caught);
      expect(error, chatModel).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors?.chatModel?.[0], chatModel).toMatch(message);
    }
    // Checked with the list of the key being typed, which is not saved while the model is wrong.
    expect(fake.calls[0].headers.get("authorization")).toBe("Bearer sk-or-v1-typed-9999");
    expect(await getOpenRouterKey()).toBeNull();
    expect((await loadIntegrationSettings()).defaultModels).toEqual({});
    expect((await getSetupStatus()).currentStep).toBe(4);

    await saveAiStep(owner, { openrouterKey: "sk-or-v1-typed-9999", chatModel: "anthropic/claude-haiku-4.5" }, { fetchImpl: fake.fetch });
    expect((await loadIntegrationSettings()).defaultModels).toMatchObject({ chat: "anthropic/claude-haiku-4.5", fallback: DEFAULT_MODELS.fallback });
  });

  it("without any key the list cannot be had: only the way the model is written is checked [ARR-14]", async () => {
    const owner = await ownerAtAiStep();
    const fake = catalogFetch();
    await saveAiStep(owner, { chatModel: "anthropic/claude-haiku-4.5" }, { fetchImpl: fake.fetch });
    expect(fake.calls).toHaveLength(0);
    expect((await loadIntegrationSettings()).defaultModels).toMatchObject({ chat: "anthropic/claude-haiku-4.5" });
  });

  it("can be done later: skipping leaves the app without AI and moves on", async () => {
    const owner = await ownerAtAiStep();
    await skipSetupStep(owner, 4);
    expect(await getOpenRouterKey()).toBeNull();
    expect((await getSetupStatus()).currentStep).toBe(5);
  });

  it("«Probar clave» checks the typed key, or the saved one, against OpenRouter (fake fetch)", async () => {
    const owner = await ownerAtAiStep();
    const seen: string[] = [];
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? "");
      return Response.json({ data: { label: "Mi clave", limit: null, usage_monthly: 1.5, is_management_key: false } });
    }) as typeof fetch;

    const typed = await testSetupOpenRouterKey(owner, { key: "sk-or-v1-typed-0001" }, { fetch: fakeFetch });
    expect(typed).toMatchObject({ valid: true, summary: "Clave válida" });

    await saveAiStep(owner, { openrouterKey: "sk-or-v1-saved-0002", chatModel: DEFAULT_MODELS.chat }, { fetchImpl: catalogFetch().fetch });
    await testSetupOpenRouterKey(owner, {}, { fetch: fakeFetch });
    expect(seen).toEqual(["Bearer sk-or-v1-typed-0001", "Bearer sk-or-v1-saved-0002"]);
  });

  it("«Probar clave» without any key says so and calls nobody; OPENROUTER_API_KEY counts as saved [ARR-15]", async () => {
    const owner = await ownerAtAiStep();
    const fakeFetch = vi.fn(async () => Response.json({ data: { label: null, limit: null } })) as unknown as typeof fetch;
    expect(await testSetupOpenRouterKey(owner, { key: "" }, { fetch: fakeFetch })).toMatchObject({ valid: false, reason: "invalid" });
    expect(fakeFetch).not.toHaveBeenCalled();
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-from-env-7777");
    expect(await testSetupOpenRouterKey(owner, {}, { fetch: fakeFetch })).toMatchObject({ valid: true });
  });
});

describe("steps 5–7 and the end [ASI-08] [ASI-09] [ASI-10] [ASI-01]", () => {
  it("the placeholder steps continue, finishing saves the date, and afterwards the wizard is closed", async () => {
    const owner = await ownerAtAiStep();
    await skipSetupStep(owner, 4);
    await skipSetupStep(owner, 5);
    await skipSetupStep(owner, 6);
    expect(await getSetupStatus()).toEqual({ hasUsers: true, completed: false, currentStep: 7 });

    await finishSetup(owner);
    const status = await getSetupStatus();
    expect(status.completed).toBe(true);
    expect((await loadBusinessSettings()).setupCompletedAt).toBeInstanceOf(Date);
    expect((await db.select().from(auditLog)).map((e) => e.action)).toContain("setup.completed");

    // Once finished, no step can change anything ([ASI-01]).
    await expect(saveBusinessStep(owner, { ...BUSINESS, name: "Otro nombre" })).rejects.toBeInstanceOf(ConflictError);
    await expect(saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [], closures: [] })).rejects.toBeInstanceOf(ConflictError);
    await expect(saveAiStep(owner, { chatModel: DEFAULT_MODELS.chat })).rejects.toBeInstanceOf(ConflictError);
    await expect(skipSetupStep(owner, 6)).rejects.toBeInstanceOf(ConflictError);
    await expect(finishSetup(owner)).rejects.toBeInstanceOf(ConflictError);
    expect((await loadBusinessSettings()).name).toBe("Peluquería Aurora");
  });

  it("the sector template is kept for the first-agent step, readable only by who manages agents", async () => {
    const owner = await ownerActor();
    await saveBusinessStep(owner, BUSINESS);
    expect(await getSetupSectorTemplate(actorFor("admin"))).not.toBeNull();
    for (const role of ["supervisor", "agent", "viewer"] as Role[]) {
      await expect(getSetupSectorTemplate(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    }
  });
});
