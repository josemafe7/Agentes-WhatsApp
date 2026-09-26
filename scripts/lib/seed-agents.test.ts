// Demo agents of `pnpm seed` (seed/steps/agents.ts): a reception agent from the sector template, an email agent and
// a prepared off-hours agent, with guided instructions, default models, hand-off rules and saved versions
// ([ARR-06], [ARR-10], [AGE-02], [AGE-04], [AGE-09], [AGE-12], [MOD-05]). Each test starts from an empty database.
// (Kept here because Vitest only collects tests under src/ and scripts/.)
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getAgent, listAgentVersions, restoreAgentVersion } from "@/data/agents";
import { db } from "@/db";
import { agents, agentVersions, channels, user, userRoles } from "@/db/schema";
import { agentCreateSchema } from "@/lib/agent-input";
import { SECTORS } from "@/lib/enums";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { providerOf } from "@/lib/openrouter/model-id";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { DEMO_BUSINESSES } from "../../seed/businesses";
import { buildDemoAgents, DEMO_AGENT_KEYS, demoAgentModels } from "../../seed/steps/agents";
import { DEMO_USERS } from "../../seed/users";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true", NODE_ENV: "development" };
const NOW = new Date("2026-09-26T10:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTIFY = ["5b0f9c2e-8d1a-4c3b-9f6e-2a7d4e1b8c90"];

async function seed(argv: string[] = []) {
  const code = await runSeedCommand(argv, { out: captureOutput(), env: DEMO_ENV, now: NOW });
  expect(code).toBe(0);
}

async function agentRows() {
  return db.select().from(agents).orderBy(asc(agents.createdAt));
}

async function demoActor(role: "owner" | "admin"): Promise<Actor> {
  const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
  const [row] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.email, demoUser?.email ?? ""));
  return { userId: row.id, role, name: row.name, channelIds: null };
}

beforeEach(async () => {
  await emptyDatabase();
});

describe("demo agents (pnpm seed)", () => {
  it("[ARR-06] [AGE-02] the demo has a reception agent from the sector template, an email agent and an off-hours agent", async () => {
    await seed();
    const rows = await agentRows();
    expect(rows).toHaveLength(3);
    const template = getSectorPreset("peluqueria").agentTemplate;
    const [reception, email, offHours] = rows;

    // Reception: the template the setup wizard offers, with the demo's later edits.
    expect(reception).toMatchObject({ name: template.name, tone: template.tone, templateSector: "peluqueria", language: "es" });
    expect(reception.instructions).toMatchObject(template.instructions);
    expect(reception.handoff.keywords).toEqual(template.handoff.keywords);
    expect(reception.handoff.messageOffHours).toBe(template.handoff.messageOffHours);

    // Email: same business knowledge, written as emails.
    expect(email.name).toBe("Asistente de correo");
    expect(email.instructions.businessInfo).toBe(template.instructions.businessInfo);
    expect(email.instructions.style).toMatch(/correo/i);
    expect(email.handoff.messageInHours).toMatch(/correo/i);

    // Off-hours: prepared, says so, and is not active anywhere.
    expect(offHours.name).toBe("Asistente fuera de horario");
    expect(offHours.description).toMatch(/no está activo/i);
    const linked = await db.select({ active: channels.activeAgentId, offHours: channels.offHoursAgentId }).from(channels);
    expect(linked.flatMap((row) => [row.active, row.offHours])).not.toContain(offHours.id);
  });

  it("[AGE-04] [AGE-09] every demo agent has guided instructions, hand-off rules and the hand-off tool", async () => {
    await seed();
    for (const row of await agentRows()) {
      for (const field of ["role", "businessInfo", "can", "cannot", "style", "handoff"] as const) {
        expect(row.instructions[field], `${row.name}: ${field}`).toBeTruthy();
      }
      expect(row.handoff.keywords?.length, row.name).toBeGreaterThan(0);
      expect(row.handoff.unknownThreshold, row.name).toBeGreaterThanOrEqual(1);
      expect(row.handoff.messageInHours, row.name).toBeTruthy();
      expect(row.handoff.messageOffHours, row.name).toBeTruthy();
      expect(row.systemTools).toContain("transferir_a_humano");
      expect(JSON.stringify(row)).not.toMatch(/undefined/);
    }
  });

  it("[MOD-05] models come from the defaults of Settings › IA, with a fallback of another provider", async () => {
    await seed();
    for (const row of await agentRows()) {
      expect(row.model).toBe(DEFAULT_MODELS.chat);
      expect(row.fallbackModel).toBe(DEFAULT_MODELS.fallback);
      expect(providerOf(row.fallbackModel ?? "")).not.toBe(providerOf(row.model ?? ""));
    }
  });

  it("[AGE-12] each agent has one or two versions with author and date, and the latest matches the agent", async () => {
    await seed();
    const owner = await demoActor("owner");
    const demoNames = DEMO_USERS.map((demoUser) => demoUser.name);
    let multiVersion = 0;
    for (const row of await agentRows()) {
      const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, row.id)).orderBy(asc(agentVersions.version));
      expect(versions.length, row.name).toBeGreaterThanOrEqual(1);
      expect(versions.length, row.name).toBeLessThanOrEqual(2);
      if (versions.length === 2) multiVersion += 1;
      expect(versions.map((version) => version.version)).toEqual(versions.map((_, index) => index + 1));
      expect(row.currentVersion).toBe(versions.length);
      for (const version of versions) {
        expect(demoNames).toContain(version.createdByName);
        expect(version.createdBy).not.toBeNull();
        expect(version.createdAt.getTime()).toBeLessThan(NOW.getTime());
        expect(version.createdAt.getTime()).toBeGreaterThan(NOW.getTime() - 60 * DAY_MS);
      }
      // Older versions first, and the agent was last changed when its latest version was saved.
      expect(versions.map((version) => version.createdAt.getTime())).toEqual(
        [...versions.map((version) => version.createdAt.getTime())].sort((a, b) => a - b),
      );
      expect(row.createdAt.getTime()).toBe(versions[0].createdAt.getTime());
      expect(row.updatedAt.getTime()).toBe(versions[versions.length - 1].createdAt.getTime());
      const latest = versions[versions.length - 1].snapshot;
      expect(latest).toMatchObject({
        name: row.name,
        tone: row.tone,
        instructions: row.instructions,
        handoff: row.handoff,
        model: row.model,
        fallbackModel: row.fallbackModel,
        systemTools: row.systemTools,
      });
      // The Versiones tab of the data layer reads them.
      const listed = await listAgentVersions(owner, row.id);
      expect(listed.find((version) => version.current)?.version).toBe(row.currentVersion);
    }
    expect(multiVersion).toBeGreaterThan(0);
  });

  it("[AGE-12] an older demo version can be restored through the agents data layer", async () => {
    await seed();
    const owner = await demoActor("owner");
    const [reception] = await agentRows();
    expect(reception.currentVersion).toBe(2);
    expect(reception.instructions.freeText).toBeTruthy();
    const restored = await restoreAgentVersion(owner, reception.id, 1);
    expect(restored.currentVersion).toBe(3);
    expect(restored.instructions.freeText).toBeUndefined();
    expect((await getAgent(owner, reception.id)).instructions).toEqual(getSectorPreset("peluqueria").agentTemplate.instructions);
  });

  it("loading the demo again replaces its agents instead of duplicating them", async () => {
    await seed();
    const first = await agentRows();
    const firstVersions = await db.select().from(agentVersions);
    await seed();
    const second = await agentRows();
    expect(second.map((row) => row.name)).toEqual(first.map((row) => row.name));
    expect(await db.select().from(agentVersions)).toHaveLength(firstVersions.length);
    // New rows (the old demo was replaced), never both.
    expect(second.map((row) => row.id)).not.toEqual(first.map((row) => row.id));
  });

  it("[ARR-10] another sector's demo gets that sector's agents and words", async () => {
    await seed(["--sector=restaurante"]);
    const rows = await agentRows();
    const template = getSectorPreset("restaurante").agentTemplate;
    expect(rows.map((row) => row.name)).toEqual([template.name, "Asistente de correo", "Asistente fuera de horario"]);
    expect(rows.every((row) => row.templateSector === "restaurante")).toBe(true);
    // Sector words: reservations and diners, not appointments and clients.
    expect(rows[1].instructions.role).toContain("reservas");
    expect(rows[1].instructions.role).toContain("comensales");
    expect(rows[1].instructions.role).toContain(DEMO_BUSINESSES.restaurante.name);
  });
});

describe("buildDemoAgents", () => {
  it.each(SECTORS)("[ARR-10] %s: three valid agents (the editor's own validation accepts every version)", (sector) => {
    const plans = buildDemoAgents({
      preset: getSectorPreset(sector),
      business: DEMO_BUSINESSES[sector],
      models: { model: DEFAULT_MODELS.chat, fallbackModel: DEFAULT_MODELS.fallback },
      notifyUserIds: NOTIFY,
    });
    expect(plans.map((plan) => plan.key)).toEqual([...DEMO_AGENT_KEYS]);
    for (const plan of plans) {
      expect(plan.versions.length).toBeGreaterThanOrEqual(1);
      expect(plan.versions.length).toBeLessThanOrEqual(2);
      for (const { config } of plan.versions) {
        const { avatarFileKey, ...input } = config;
        expect(avatarFileKey).toBeNull();
        const parsed = agentCreateSchema.safeParse(input);
        expect(parsed.success, `${sector}/${plan.key}: ${parsed.error?.message ?? ""}`).toBe(true);
        expect(JSON.stringify(config), `${sector}/${plan.key}`).not.toMatch(/undefined/);
      }
    }
  });

  it("[AGE-09] the reception agent's later version notifies the chosen people", () => {
    const [reception] = buildDemoAgents({
      preset: getSectorPreset("peluqueria"),
      business: DEMO_BUSINESSES.peluqueria,
      models: { model: DEFAULT_MODELS.chat, fallbackModel: DEFAULT_MODELS.fallback },
      notifyUserIds: NOTIFY,
    });
    expect(reception.versions[0].config.handoff.notifyUserIds).toBeUndefined();
    expect(reception.versions[reception.versions.length - 1].config.handoff.notifyUserIds).toEqual(NOTIFY);
  });
});

describe("demoAgentModels [MOD-05]", () => {
  it("uses the defaults of Settings › IA, or the recommended ones when empty", () => {
    expect(demoAgentModels({})).toEqual({ model: DEFAULT_MODELS.chat, fallbackModel: DEFAULT_MODELS.fallback });
    expect(demoAgentModels({ chat: "anthropic/claude-sonnet-5", fallback: "openai/gpt-5.6-luna" })).toEqual({
      model: "anthropic/claude-sonnet-5",
      fallbackModel: "openai/gpt-5.6-luna",
    });
  });

  it("never pairs two models of the same provider", () => {
    const pair = demoAgentModels({ chat: "google/gemini-3.1-pro", fallback: "google/gemini-3.1-flash-lite" });
    expect(pair.model).toBe("google/gemini-3.1-pro");
    expect(providerOf(pair.fallbackModel)).not.toBe("google");
  });
});
