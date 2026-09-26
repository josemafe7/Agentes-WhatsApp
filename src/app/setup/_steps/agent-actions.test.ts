// Step 5 «Primer agente» of /setup ([ASI-08], [ASI-11], [AGE-05], [AGE-15], [SEG-04], [SEG-05], [SEG-07]): its Server
// Actions called directly, as an attacker could. Better Auth, headers and redirect are replaced, and so is the draft
// generator (it reads the web and calls OpenRouter, never in tests); the data layer and the database are real.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeSession = { session: { id: string }; user: { id: string } };
const state = vi.hoisted(() => ({
  session: null as FakeSession | null,
  draftCalls: [] as unknown[],
  draftError: null as Error | null,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
// Step 2 may store a logo: tests never write into the project's data/uploads.
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  const memory = {
    kind: "disk" as const,
    put: async (key: string, data: Uint8Array) => ({ key, size: data.byteLength }),
    get: async () => null,
    delete: async () => undefined,
    exists: async () => false,
  };
  return { ...original, getFileStorage: () => memory };
});
vi.mock("@/server/ai/draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/draft")>()),
  generateAgentDraft: async (input: unknown) => {
    state.draftCalls.push(input);
    if (state.draftError) throw state.draftError;
    return {
      name: "Recepción de Peluquería Prueba",
      tone: "Cercano y alegre",
      instructions: {
        role: "Eres la recepcionista virtual de Peluquería Prueba, en Valencia.",
        businessInfo: "Peluquería unisex con dos estilistas; abre de martes a sábado.",
        can: "Informar de servicios, precios orientativos y horarios.",
        cannot: "Dar precios que no estén en la lista.",
        style: "Cercano y breve, tratando de tú.",
        handoff: "Quejas, bodas y cambios de última hora.",
      },
      faqs: [{ question: "¿Cortáis el pelo a niños?", answer: "Sí, hasta los 12 años." }],
      source: { kind: "url", url: "https://peluqueria-prueba.example/", title: "Peluquería Prueba", truncated: false },
      runId: "00000000-0000-4000-8000-000000000000",
      costUsd: 0.0012,
    };
  },
}));

import { db } from "@/db";
import { agents, agentVersions, appKv, auditLog, businessSettings, integrationSettings } from "@/db/schema";
import { getAgent } from "@/data/agents";
import { ensureSettingsRows } from "@/data/settings";
import { createOwner, finishSetup, getSetupStatus, saveBusinessStep, saveHoursStep, SETUP_STEP, skipSetupStep } from "@/data/setup";
import {
  getSetupAgentStepData,
  getSetupFirstAgent,
  NO_KEY_FOR_DRAFT_MESSAGE,
  saveSetupAgentStep,
  SETUP_FIRST_AGENT_KEY,
} from "@/data/setup-agent";
import type { Sector } from "@/lib/enums";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { openRouterErrorFrom } from "@/lib/openrouter/errors";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { AgentDraftError } from "@/server/ai/draft";
import { clearAllData } from "@/server/demo/clear-data";
import { WebFetchError } from "@/server/web-fetch";
import { createUser, TEST_PASSWORD } from "@/test/factories";
import { openRouterModelSchema } from "@/lib/openrouter/schemas";
import { MODEL_CATALOG_KV_KEY, normalizeModel } from "@/server/ai/models";
import { setKv } from "@/server/kv";
import { FAKE_OPENROUTER_KEY, sampleCatalog } from "@/test/fake-openrouter";
import { skipStepAction } from "../actions";
import { generateAgentDraftAction, saveAgentStepAction } from "./agent-actions";

const OWNER = { name: "Ana Dueña", email: "ana@example.com", password: TEST_PASSWORD };
const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const SIGNED_OUT = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
const TO_STEP_6 = "REDIRECT:/setup?paso=6";
const GUIDED = ["role", "businessInfo", "can", "cannot", "style", "handoff"] as const;

function signInAs(userId: string | null) {
  state.session = userId ? { session: { id: `s-${userId}` }, user: { id: userId } } : null;
}

/** The step's form as the browser sends it: name, tone and every instruction field. */
function stepForm(values: { name?: string; tone?: string; instructions?: Record<string, string> }): FormData {
  const data = new FormData();
  if (values.name !== undefined) data.append("name", values.name);
  if (values.tone !== undefined) data.append("tone", values.tone);
  for (const [key, value] of Object.entries(values.instructions ?? {})) data.append(`instructions.${key}`, value);
  return data;
}

/** The form exactly as step 5 shows it for a sector (the template's values). */
function templateForm(sector: Sector = "peluqueria", overrides: { name?: string; tone?: string } = {}): FormData {
  const template = getSectorPreset(sector).agentTemplate;
  return stepForm({ name: overrides.name ?? template.name, tone: overrides.tone ?? template.tone, instructions: { ...template.instructions, freeText: "" } });
}

/** A signed-in owner whose first pending step is 5 (business, hours and AI done). */
async function ownerAtAgentStep(sector: Sector = "peluqueria"): Promise<Actor> {
  const { userId } = await createOwner(OWNER);
  signInAs(userId);
  const actor: Actor = { userId, role: "owner", name: OWNER.name, channelIds: null };
  await saveBusinessStep(actor, { name: "Peluquería Prueba", sector, color: "#3d6df2" });
  await saveHoursStep(actor, { timezone: "Europe/Madrid", hours: [], closures: [] });
  await skipSetupStep(actor, SETUP_STEP.ai);
  return actor;
}

async function agentRows() {
  return db.select().from(agents);
}

/** The model list as the pickers leave it saved (one model of each exclusion). */
async function cacheSampleCatalog() {
  const models = sampleCatalog().flatMap((entry) => {
    const parsed = openRouterModelSchema.safeParse(entry);
    return parsed.success ? [normalizeModel(parsed.data)] : [];
  });
  await setKv(MODEL_CATALOG_KV_KEY, { format: 1, fetchedAt: new Date().toISOString(), source: "user", models });
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  state.draftCalls.length = 0;
  state.draftError = null;
  signInAs(null);
  await db.transaction((tx) => clearAllData(tx));
  await ensureSettingsRows();
});

describe("saveAgentStepAction [ASI-08]", () => {
  it("creates the first agent from the sector template with the chosen name and tone, keeps it for step 6 and moves on", async () => {
    const owner = await ownerAtAgentStep();
    await expect(saveAgentStepAction(undefined, templateForm("peluqueria", { name: "Recepción Aurora", tone: "Cercano" }))).rejects.toThrow(TO_STEP_6);

    const [agent] = await agentRows();
    const template = getSectorPreset("peluqueria").agentTemplate;
    expect(agent).toMatchObject({ name: "Recepción Aurora", tone: "Cercano", templateSector: "peluqueria", currentVersion: 1 });
    expect(agent.instructions).toEqual(template.instructions);
    // The rest comes from the template and Settings › IA ([MOD-05]).
    expect(agent.handoff).toMatchObject({ keywords: template.handoff.keywords, messageOffHours: template.handoff.messageOffHours });
    expect(agent.model).toBe(DEFAULT_MODELS.chat);
    expect(agent.systemTools).toContain("transferir_a_humano");

    expect(await getSetupFirstAgent(owner)).toEqual({ id: agent.id, name: "Recepción Aurora" });
    expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.webchat, completed: false });
    const actions = (await db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["agent.created", "setup.agent_created"]));
  });

  it("uses the template of the business sector", async () => {
    await ownerAtAgentStep("restaurante");
    await expect(saveAgentStepAction(undefined, stepForm({ name: "Reservas" }))).rejects.toThrow(TO_STEP_6);
    const [agent] = await agentRows();
    const template = getSectorPreset("restaurante").agentTemplate;
    expect(agent).toMatchObject({ name: "Reservas", templateSector: "restaurante" });
    // Without instruction fields in the form, the template's are kept.
    expect(agent.instructions).toEqual(template.instructions);
    expect(agent.tone).toBe(template.tone);
  });

  it("a field sent empty-handed (undefined) keeps the template's value", async () => {
    const owner = await ownerAtAgentStep("taller");
    await saveSetupAgentStep(owner, { name: "Taller", tone: undefined, instructions: undefined });
    const [agent] = await agentRows();
    const template = getSectorPreset("taller").agentTemplate;
    expect(agent).toMatchObject({ name: "Taller", tone: template.tone, instructions: template.instructions });
  });

  it("saves the instructions as edited in the form (for example, a reviewed draft)", async () => {
    await ownerAtAgentStep();
    const instructions = { role: "Eres Nuria, la recepcionista de Peluquería Prueba.", style: "Muy breve.", freeText: "Nunca hables de la competencia." };
    await expect(saveAgentStepAction(undefined, stepForm({ name: "Nuria", tone: "Cercano", instructions }))).rejects.toThrow(TO_STEP_6);
    const [agent] = await agentRows();
    expect(agent.instructions).toEqual(instructions);
  });

  it("keeps the FAQs kept from a draft in the setup progress, for the knowledge base, and shows them again", async () => {
    const owner = await ownerAtAgentStep();
    const faqs = [{ question: "¿Cortáis el pelo a niños?", answer: "Sí, hasta los 12 años." }];
    const form = templateForm();
    form.append("faqs", JSON.stringify(faqs));
    await expect(saveAgentStepAction(undefined, form)).rejects.toThrow(TO_STEP_6);
    const [agent] = await agentRows();
    const [kept] = await db.select().from(appKv).where(eq(appKv.key, SETUP_FIRST_AGENT_KEY));
    expect(kept.value).toEqual({ agentId: agent.id, faqs });
    expect((await getSetupAgentStepData(owner)).values.faqs).toEqual(faqs);
    // Saving again without FAQs in the form keeps them.
    await expect(saveAgentStepAction(undefined, templateForm())).rejects.toThrow(TO_STEP_6);
    expect((await getSetupAgentStepData(owner)).values.faqs).toEqual(faqs);
  });

  it("[ASI-08] the proposed FAQs are saved as the owner edited them; an emptied one is explained in Spanish next to it", async () => {
    await ownerAtAgentStep();
    const edited = [{ question: "¿Atendéis a niños?", answer: "Sí, y los sábados por la mañana hay hueco para ellos." }];
    const form = templateForm();
    form.append("faqs", JSON.stringify(edited));
    await expect(saveAgentStepAction(undefined, form)).rejects.toThrow(TO_STEP_6);
    const [kept] = await db.select().from(appKv).where(eq(appKv.key, SETUP_FIRST_AGENT_KEY));
    expect((kept.value as { faqs: unknown }).faqs).toEqual(edited);

    const emptied = templateForm();
    emptied.append("faqs", JSON.stringify([{ question: "¿Atendéis a niños?", answer: "  " }]));
    const result = await saveAgentStepAction(undefined, emptied);
    expect(result).toMatchObject({ ok: false, fieldErrors: { "faqs.0.answer": ["Escribe la respuesta."] } });
  });

  it("[MOD-05] the first agent's models pass the checks of any agent: a default model that is not in the list is explained and nothing is created", async () => {
    await ownerAtAgentStep();
    await cacheSampleCatalog();
    await db.update(integrationSettings).set({ defaultModels: { chat: "no-existe/modelo" } });
    const result = await saveAgentStepAction(undefined, templateForm());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^El modelo por defecto de Ajustes › IA \(no-existe\/modelo\) no sirve para un agente/) });
    expect(await agentRows()).toHaveLength(0);
    expect((await getSetupStatus()).currentStep).toBe(SETUP_STEP.agent);
  });

  it("[SEG-05] FAQs that are not valid are refused and nothing is saved", async () => {
    await ownerAtAgentStep();
    for (const faqs of ["no es json", JSON.stringify([{ question: "", answer: "x" }]), JSON.stringify({ question: "a" }), "x".repeat(40_000)]) {
      const form = templateForm();
      form.append("faqs", faqs);
      const result = await saveAgentStepAction(undefined, form);
      expect(result.ok, faqs.slice(0, 30)).toBe(false);
      expect(!result.ok && Object.keys(result.fieldErrors ?? {}).some((key) => key.startsWith("faqs"))).toBe(true);
    }
    expect(await agentRows()).toEqual([]);
  });

  it("[ASI-11] coming back to the step shows what was saved, and saving again edits that agent instead of creating another", async () => {
    const owner = await ownerAtAgentStep();
    await expect(saveAgentStepAction(undefined, templateForm("peluqueria", { name: "Recepción" }))).rejects.toThrow(TO_STEP_6);
    const [created] = await agentRows();

    const data = await getSetupAgentStepData(owner);
    expect(data).toMatchObject({ agentId: created.id, values: { name: "Recepción", tone: created.tone } });
    expect(data.values.instructions).toEqual(created.instructions);

    // Unchanged: no new version.
    await expect(saveAgentStepAction(undefined, templateForm("peluqueria", { name: "Recepción" }))).rejects.toThrow(TO_STEP_6);
    expect(await db.select().from(agentVersions)).toHaveLength(1);

    await expect(saveAgentStepAction(undefined, templateForm("peluqueria", { name: "Recepción Aurora", tone: "Alegre" }))).rejects.toThrow(TO_STEP_6);
    const rows = await agentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: created.id, name: "Recepción Aurora", tone: "Alegre", currentVersion: 2 });
    expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.webchat });
  });

  it("if that agent was deleted in the meantime, saving creates a new one", async () => {
    const owner = await ownerAtAgentStep();
    await expect(saveAgentStepAction(undefined, templateForm())).rejects.toThrow(TO_STEP_6);
    const [first] = await agentRows();
    await db.delete(agentVersions);
    await db.delete(agents);
    expect(await getSetupFirstAgent(owner)).toBeNull();

    await expect(saveAgentStepAction(undefined, templateForm("peluqueria", { name: "Otra vez" }))).rejects.toThrow(TO_STEP_6);
    const [second] = await agentRows();
    expect(second.id).not.toBe(first.id);
    expect(await getSetupFirstAgent(owner)).toEqual({ id: second.id, name: "Otra vez" });
  });

  it("[AGE-15] [SEG-05] a missing name or a too long instruction is explained next to its field and nothing is saved", async () => {
    await ownerAtAgentStep();
    expect(await saveAgentStepAction(undefined, templateForm("peluqueria", { name: "   " }))).toMatchObject({
      ok: false,
      fieldErrors: { name: ["Escribe el nombre del agente."] },
    });
    expect(await saveAgentStepAction(undefined, stepForm({ tone: "Cercano" }))).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
    expect(await saveAgentStepAction(undefined, stepForm({ name: "Recepción", instructions: { role: "x".repeat(4_001) } }))).toMatchObject({
      ok: false,
      fieldErrors: { "instructions.role": ["Como mucho 4000 caracteres."] },
    });
    expect(await agentRows()).toEqual([]);
    expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.agent });
  });

  it("[SEG-05] only the name, tone and instructions can be set from the wizard", async () => {
    const owner = await ownerAtAgentStep();
    await expect(saveSetupAgentStep(owner, { name: "Recepción", model: "openai/otro-modelo" })).rejects.toMatchObject({ status: 400 });
    await expect(saveSetupAgentStep(owner, { name: "Recepción", instructions: { role: "Hola", secreto: "x" } })).rejects.toMatchObject({ status: 400 });
    await expect(saveSetupAgentStep(owner, "Recepción")).rejects.toMatchObject({ status: 400 });
    expect(await agentRows()).toEqual([]);
  });

  it("is refused while an earlier step is pending, and once the wizard is finished", async () => {
    const { userId } = await createOwner(OWNER);
    signInAs(userId);
    const early = await saveAgentStepAction(undefined, templateForm());
    expect(early).toEqual({ ok: false, error: "Completa antes los pasos anteriores del asistente." });

    const owner: Actor = { userId, role: "owner", name: OWNER.name, channelIds: null };
    await db.update(businessSettings).set({ setupStep: SETUP_STEP.channels });
    await finishSetup(owner);
    expect(await saveAgentStepAction(undefined, templateForm())).toEqual({ ok: false, error: "La configuración inicial ya está terminada." });
    expect(await agentRows()).toEqual([]);
  });

  it("«Saltar este paso» creates no agent and goes to step 6", async () => {
    const owner = await ownerAtAgentStep();
    await expect(skipStepAction(SETUP_STEP.agent)).rejects.toThrow(TO_STEP_6);
    expect(await agentRows()).toEqual([]);
    expect(await getSetupFirstAgent(owner)).toBeNull();
    expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.webchat });
  });
});

describe("step 5 permissions [ASI-11] [SEG-04] [PER-01]", () => {
  it("without a session every action asks to sign in again and nothing changes", async () => {
    await ownerAtAgentStep();
    signInAs(null);
    expect(await saveAgentStepAction(undefined, templateForm())).toEqual(SIGNED_OUT);
    expect(await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.example" })).toEqual(SIGNED_OUT);
    expect(await agentRows()).toEqual([]);
    expect(state.draftCalls).toEqual([]);
  });

  it.each(["admin", "supervisor", "agent", "viewer"] as const)(
    "%s cannot continue the wizard (not even an admin, who can create agents in Agentes)",
    async (role) => {
      await ownerAtAgentStep();
      vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
      const other = await createUser(role);
      signInAs(other.userId);
      await db.delete(auditLog);

      expect(await saveAgentStepAction(undefined, templateForm())).toEqual(FORBIDDEN);
      expect(await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.example" })).toEqual(FORBIDDEN);
      await expect(getSetupAgentStepData(other.actor)).rejects.toMatchObject({ status: 403 });
      await expect(getSetupFirstAgent(other.actor)).rejects.toMatchObject({ status: 403 });

      expect(await agentRows()).toEqual([]);
      expect(state.draftCalls).toEqual([]);
      expect(await db.select().from(auditLog)).toEqual([]);
      expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.agent });
    },
  );
});

describe("getSetupAgentStepData [ASI-08]", () => {
  it("starts from the sector template, says whether there is an OpenRouter key and offers the business website", async () => {
    const owner = await ownerAtAgentStep("clinica-dental");
    await db.update(businessSettings).set({ website: "https://clinica-prueba.example" });
    const template = getSectorPreset("clinica-dental").agentTemplate;

    const withoutKey = await getSetupAgentStepData(owner);
    expect(withoutKey).toMatchObject({
      sector: "clinica-dental",
      sectorLabel: getSectorPreset("clinica-dental").label,
      agentId: null,
      aiConfigured: false,
      website: "https://clinica-prueba.example",
      values: { name: template.name, tone: template.tone, instructions: template.instructions },
    });

    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    expect((await getSetupAgentStepData(owner)).aiConfigured).toBe(true);
  });
});

describe("generateAgentDraftAction «Generar desde la web del negocio» [ASI-08] [AGE-05]", () => {
  it("[ARR-14] without an OpenRouter key it explains that the key is needed and calls nothing", async () => {
    await ownerAtAgentStep();
    const result = await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.example" });
    expect(result).toEqual({ ok: false, error: NO_KEY_FOR_DRAFT_MESSAGE });
    expect(state.draftCalls).toEqual([]);
  });

  it("with a key it reads the address (completing https://) and returns an editable draft without saving anything", async () => {
    await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const result = await generateAgentDraftAction({ source: "url", url: "www.peluqueria-prueba.example" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        name: "Recepción de Peluquería Prueba",
        tone: "Cercano y alegre",
        instructions: { role: expect.stringContaining("Peluquería Prueba") },
        faqs: [{ question: "¿Cortáis el pelo a niños?", answer: "Sí, hasta los 12 años." }],
      },
    });
    expect(result.ok && result.data ? Object.keys(result.data.instructions) : []).toEqual(expect.arrayContaining([...GUIDED]));
    // Adapted from the business and its sector template; not linked to any agent yet.
    expect(state.draftCalls).toEqual([
      {
        source: { url: "https://www.peluqueria-prueba.example" },
        sector: "peluqueria",
        business: { name: "Peluquería Prueba", terminology: getSectorPreset("peluqueria").terminology },
        agentId: null,
      },
    ]);
    expect(await agentRows()).toEqual([]);
    expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.agent });
  });

  it("from a description, when the web cannot be used", async () => {
    await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const description = "Peluquería unisex en Valencia con dos estilistas y una esteticista.";
    expect((await generateAgentDraftAction({ source: "description", description })).ok).toBe(true);
    expect(state.draftCalls).toMatchObject([{ source: { description } }]);
  });

  it("coming back to the step, the cost of a new draft is linked to the agent it created", async () => {
    await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    await expect(saveAgentStepAction(undefined, templateForm())).rejects.toThrow(TO_STEP_6);
    const [agent] = await agentRows();
    expect((await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.example" })).ok).toBe(true);
    expect(state.draftCalls).toMatchObject([{ agentId: agent.id }]);
  });

  it("a web that cannot be read is explained with its reason and nothing is saved (the form keeps the template)", async () => {
    await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    state.draftError = new WebFetchError("host_not_found");
    const result = await generateAgentDraftAction({ source: "url", url: "https://no-existe.example" });
    expect(result).toEqual({ ok: false, error: "No se encuentra esa web. Revisa la dirección." });
    expect(await agentRows()).toEqual([]);
  });

  it("[SEG-14] an AI failure shows its generic Spanish message", async () => {
    await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    state.draftError = new AgentDraftError("invalid_draft", "La IA no ha devuelto un borrador válido. Inténtalo de nuevo.", true, null);
    expect(await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.example" })).toEqual({
      ok: false,
      error: "La IA no ha devuelto un borrador válido. Inténtalo de nuevo.",
    });
    const noCredits = openRouterErrorFrom(402, { code: 402 });
    state.draftError = noCredits;
    expect(await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.example" })).toEqual({
      ok: false,
      error: noCredits.userMessage,
    });
    expect(await agentRows()).toEqual([]);
  });

  it("[SEG-05] a wrong address or a too short description is explained and nothing is generated", async () => {
    await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    expect(await generateAgentDraftAction({ source: "url", url: "ftp://peluqueria.example" })).toMatchObject({ ok: false, fieldErrors: { url: expect.any(Array) } });
    expect(await generateAgentDraftAction({ source: "url", url: "" })).toMatchObject({ ok: false, fieldErrors: { url: expect.any(Array) } });
    expect(await generateAgentDraftAction({ source: "description", description: "Pelu" })).toMatchObject({ ok: false, fieldErrors: { description: expect.any(Array) } });
    expect(await generateAgentDraftAction("https://peluqueria.example")).toMatchObject({ ok: false });
    expect(state.draftCalls).toEqual([]);
  });

  it("[SEG-07] is limited per person: 5 per minute", async () => {
    await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const input = { source: "url", url: "https://peluqueria-prueba.example" };
    for (let i = 0; i < 5; i += 1) expect((await generateAgentDraftAction(input)).ok).toBe(true);
    expect(await generateAgentDraftAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("Espera un minuto") });
    expect(state.draftCalls).toHaveLength(5);
  });

  it("is refused once the wizard is finished", async () => {
    const owner = await ownerAtAgentStep();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    await db.update(businessSettings).set({ setupStep: SETUP_STEP.channels });
    await finishSetup(owner);
    expect(await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.example" })).toEqual({
      ok: false,
      error: "La configuración inicial ya está terminada.",
    });
    expect(state.draftCalls).toEqual([]);
  });
});

describe("the created agent is a normal agent [AGE-02] [AGE-12]", () => {
  it("can be opened from Agentes with its first version", async () => {
    const owner = await ownerAtAgentStep();
    await expect(saveAgentStepAction(undefined, templateForm("peluqueria", { name: "Recepción" }))).rejects.toThrow(TO_STEP_6);
    const ref = await getSetupFirstAgent(owner);
    const agent = await getAgent(owner, ref?.id ?? "");
    expect(agent.name).toBe("Recepción");
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, agent.id));
    expect(versions).toMatchObject([{ version: 1, createdByName: OWNER.name }]);
  });
});
