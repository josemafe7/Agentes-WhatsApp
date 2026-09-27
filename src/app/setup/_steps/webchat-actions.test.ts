// Step 6 «Chat web de prueba» of /setup ([ASI-09], [ASI-11], [ASI-01], [SEG-04], [SEG-05]): its Server Action called
// directly, as an attacker could. Better Auth, headers and redirect are replaced; the data layer and the database are real.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeSession = { session: { id: string }; user: { id: string } };
const state = vi.hoisted(() => ({ session: null as FakeSession | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
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

import { db } from "@/db";
import { auditLog, businessSettings, channels } from "@/db/schema";
import { deleteChannel } from "@/data/channels";
import { ensureSettingsRows } from "@/data/settings";
import { createOwner, finishSetup, getSetupStatus, saveBusinessStep, saveHoursStep, SETUP_STEP, skipSetupStep } from "@/data/setup";
import { saveSetupAgentStep } from "@/data/setup-agent";
import { getSetupWebchatStepData } from "@/data/setup-webchat";
import type { Actor } from "@/lib/permissions";
import { readWebchatConfig } from "@/lib/webchat-config";
import { clearAllData } from "@/server/demo/clear-data";
import { createUser, TEST_PASSWORD } from "@/test/factories";
import { skipStepAction } from "../actions";
import { createSetupWebchatAction } from "./webchat-actions";

const OWNER = { name: "Ana Dueña", email: "ana@example.com", password: TEST_PASSWORD };
const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const SIGNED_OUT = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
const BACK_TO_STEP_6 = "REDIRECT:/setup?paso=6";

function signInAs(userId: string | null) {
  state.session = userId ? { session: { id: `s-${userId}` }, user: { id: userId } } : null;
}

function nameForm(name: string): FormData {
  const data = new FormData();
  data.append("name", name);
  return data;
}

/** A signed-in owner whose first pending step is 6; with `agent`, step 5 created «Recepción Aurora». */
async function ownerAtWebchatStep({ agent = true } = {}): Promise<{ owner: Actor; agentId: string | null }> {
  const { userId } = await createOwner(OWNER);
  signInAs(userId);
  const owner: Actor = { userId, role: "owner", name: OWNER.name, channelIds: null };
  await saveBusinessStep(owner, { name: "Peluquería Prueba", sector: "peluqueria", color: "#3d6df2" });
  await saveHoursStep(owner, { timezone: "Europe/Madrid", hours: [], closures: [] });
  await skipSetupStep(owner, SETUP_STEP.ai);
  if (!agent) {
    await skipSetupStep(owner, SETUP_STEP.agent);
    return { owner, agentId: null };
  }
  const { agentId } = await saveSetupAgentStep(owner, { name: "Recepción Aurora" });
  return { owner, agentId };
}

beforeEach(async () => {
  signInAs(null);
  await db.transaction((tx) => clearAllData(tx));
  await ensureSettingsRows();
});

describe("createSetupWebchatAction [ASI-09]", () => {
  it("creates a web chat with the agent of step 5 active and the AI on, and marks the step done", async () => {
    const { owner, agentId } = await ownerAtWebchatStep();
    await expect(createSetupWebchatAction(undefined, nameForm("Chat de la web"))).rejects.toThrow(BACK_TO_STEP_6);

    const [channel] = await db.select().from(channels);
    expect(channel).toMatchObject({ type: "webchat", name: "Chat de la web", status: "connected", activeAgentId: agentId, aiEnabled: true, replyMode: "auto" });
    // No domains yet: it only works inside the app, in /widget-demo ([WEB-10]).
    expect(readWebchatConfig(channel.config).allowedDomains).toEqual([]);
    expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.channels, completed: false });
    expect(await getSetupWebchatStepData(owner)).toEqual({
      agent: { id: agentId, name: "Recepción Aurora" },
      channel: { id: channel.id, name: "Chat de la web", activeAgentName: "Recepción Aurora" },
    });
    const actions = (await db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["channel.created", "setup.webchat_created"]));
  });

  it("coming back to the step keeps the chat already created instead of adding another", async () => {
    await ownerAtWebchatStep();
    await expect(createSetupWebchatAction(undefined, nameForm("Chat de la web"))).rejects.toThrow(BACK_TO_STEP_6);
    await expect(createSetupWebchatAction(undefined, nameForm("Otro chat"))).rejects.toThrow(BACK_TO_STEP_6);
    const rows = await db.select().from(channels);
    expect(rows.map((row) => row.name)).toEqual(["Chat de la web"]);
  });

  it("if that chat was deleted from Canales, it creates it again", async () => {
    const { owner } = await ownerAtWebchatStep();
    await expect(createSetupWebchatAction(undefined, nameForm("Chat de la web"))).rejects.toThrow(BACK_TO_STEP_6);
    const [first] = await db.select().from(channels);
    await deleteChannel(owner, first.id);
    expect((await getSetupWebchatStepData(owner)).channel).toBeNull();

    await expect(createSetupWebchatAction(undefined, nameForm("Chat nuevo"))).rejects.toThrow(BACK_TO_STEP_6);
    const rows = await db.select().from(channels);
    expect(rows.map((row) => row.name)).toEqual(["Chat nuevo"]);
  });

  it("with step 5 skipped, the chat has no agent yet and says so", async () => {
    const { owner } = await ownerAtWebchatStep({ agent: false });
    expect(await getSetupWebchatStepData(owner)).toEqual({ agent: null, channel: null });
    await expect(createSetupWebchatAction(undefined, nameForm("Chat de la web"))).rejects.toThrow(BACK_TO_STEP_6);
    const [channel] = await db.select().from(channels);
    expect(channel.activeAgentId).toBeNull();
    expect((await getSetupWebchatStepData(owner)).channel).toMatchObject({ activeAgentName: null });
  });

  it("a missing or too long name is explained next to the field and nothing is created [SEG-05]", async () => {
    await ownerAtWebchatStep();
    expect(await createSetupWebchatAction(undefined, nameForm("   "))).toMatchObject({ ok: false, fieldErrors: { name: ["Escribe el nombre."] } });
    expect(await createSetupWebchatAction(undefined, nameForm("x".repeat(81)))).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
    expect(await createSetupWebchatAction(undefined, new FormData())).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
    expect(await db.select().from(channels)).toEqual([]);
    expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.webchat });
  });

  it("does not work before step 5 is done nor once the wizard is finished [ASI-01] [ASI-11]", async () => {
    const { userId } = await createOwner(OWNER);
    signInAs(userId);
    expect(await createSetupWebchatAction(undefined, nameForm("Chat de la web"))).toEqual({ ok: false, error: "Completa antes los pasos anteriores del asistente." });

    const owner: Actor = { userId, role: "owner", name: OWNER.name, channelIds: null };
    await db.update(businessSettings).set({ setupStep: SETUP_STEP.channels });
    await finishSetup(owner);
    expect(await createSetupWebchatAction(undefined, nameForm("Chat de la web"))).toEqual({ ok: false, error: "La configuración inicial ya está terminada." });
    expect(await db.select().from(channels)).toEqual([]);
  });

  it("«Saltar este paso» creates no chat and goes to step 7", async () => {
    const { owner } = await ownerAtWebchatStep();
    await expect(skipStepAction(SETUP_STEP.webchat)).rejects.toThrow("REDIRECT:/setup?paso=7");
    expect(await db.select().from(channels)).toEqual([]);
    expect(await getSetupWebchatStepData(owner)).toMatchObject({ channel: null });
  });
});

describe("step 6 permissions [ASI-11] [SEG-04] [PER-01]", () => {
  it("without a session it asks to sign in again and nothing changes", async () => {
    await ownerAtWebchatStep();
    signInAs(null);
    expect(await createSetupWebchatAction(undefined, nameForm("Chat de la web"))).toEqual(SIGNED_OUT);
    expect(await db.select().from(channels)).toEqual([]);
  });

  it.each(["admin", "supervisor", "agent", "viewer"] as const)(
    "%s cannot continue the wizard (not even an admin, who can create web chats in Canales)",
    async (role) => {
      await ownerAtWebchatStep();
      const other = await createUser(role);
      signInAs(other.userId);
      await db.delete(auditLog);

      expect(await createSetupWebchatAction(undefined, nameForm("Chat de la web"))).toEqual(FORBIDDEN);
      await expect(getSetupWebchatStepData(other.actor)).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(channels)).toEqual([]);
      expect(await db.select().from(auditLog).where(eq(auditLog.action, "channel.created"))).toEqual([]);
      expect(await getSetupStatus()).toMatchObject({ currentStep: SETUP_STEP.webchat });
    },
  );
});
