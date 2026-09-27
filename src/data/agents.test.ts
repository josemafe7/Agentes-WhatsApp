import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  agentContextFiles,
  agents,
  agentVersions,
  appKv,
  auditLog,
  channels,
  conversations,
  integrationSettings,
  messages,
  userRoles,
} from "@/db/schema";
import { SECTORS, type Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { openRouterModelSchema } from "@/lib/openrouter/schemas";
import { getSectorPreset } from "@/lib/sectors";
import type { FileStorage } from "@/server/adapters/file-storage";
import { MODEL_CATALOG_KV_KEY, normalizeModel } from "@/server/ai/models";
import { AuthError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { setKv } from "@/server/kv";
import { FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { actorFor, createBusiness, createChannel, createUser } from "@/test/factories";
import {
  canViewAgentAvatar,
  createAgent,
  createAgentFromTemplate,
  deleteAgent,
  duplicateAgent,
  getAgent,
  getAgentForTesting,
  getAgentVersion,
  listAgents,
  listAgentVersions,
  removeAgentAvatar,
  restoreAgentVersion,
  saveAgentAvatar,
  updateAgent,
} from "./agents";

// Real users: agents and versions keep who created them.
let owner: Actor;
let admin: Actor;
const viewers: Role[] = ["supervisor", "viewer"];
const notManagers: Role[] = ["supervisor", "agent", "viewer"];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function memoryStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: FileStorage = {
    kind: "disk",
    async put(key, data) {
      files.set(key, data);
      return { key, size: data.byteLength };
    },
    async get(key) {
      const data = files.get(key);
      return data ? { stream: new Response(new Uint8Array(data)).body!, contentType: "image/png", size: data.byteLength } : null;
    },
    async delete(key) {
      files.delete(key);
    },
    async exists(key) {
      return files.has(key);
    },
  };
  return { storage, files };
}

async function cacheCatalog() {
  const models = sampleCatalog().flatMap((entry) => {
    const parsed = openRouterModelSchema.safeParse(entry);
    return parsed.success ? [normalizeModel(parsed.data)] : [];
  });
  await setKv(MODEL_CATALOG_KV_KEY, { format: 1, fetchedAt: new Date().toISOString(), source: "user", models });
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

async function versionCount(agentId: string) {
  return (await db.select().from(agentVersions).where(eq(agentVersions.agentId, agentId))).length;
}

beforeAll(async () => {
  owner = (await createUser("owner", { name: "Lola Propietaria" })).actor;
  admin = (await createUser("admin", { name: "Ana Admin" })).actor;
});

/** Each test starts without agents or channels (children first: nothing relies on cascades). */
async function clearAgentsAndChannels() {
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(channels);
  await db.delete(agentContextFiles);
  await db.delete(agentVersions);
  await db.delete(agents);
  await db.delete(auditLog);
}

beforeEach(async () => {
  await clearAgentsAndChannels();
  await createBusiness();
  await db.update(integrationSettings).set({ defaultModels: {} });
  await db.delete(appKv);
});

describe("creating agents [AGE-02] [AGE-12] [AGE-15]", () => {
  it("a blank agent needs only a name; models come from Settings › IA and it starts with the hand-off tool", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    expect(agent).toMatchObject({
      name: "Recepción",
      language: "es",
      model: "openai/gpt-5.6-luna",
      fallbackModel: "google/gemini-3.1-flash-lite",
      knowledgeMode: "auto",
      systemTools: ["transferir_a_humano"],
      currentVersion: 1,
      createdBy: owner.userId,
    });
    const versions = await listAgentVersions(owner, agent.id);
    expect(versions).toEqual([{ version: 1, createdAt: expect.any(Date), createdByName: "Lola Propietaria", current: true }]);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.targetId, agent.id));
    expect(audit).toMatchObject({ action: "agent.created", actorUserId: owner.userId });
  });

  it("uses the chat model chosen in Settings › IA and a fallback of another provider", async () => {
    await db.update(integrationSettings).set({ defaultModels: { chat: "google/gemini-3.1-flash-lite", fallback: "google/gemini-2.9-pro" } });
    const agent = await createAgent(admin, { name: "Recepción" });
    expect(agent).toMatchObject({ model: "google/gemini-3.1-flash-lite", fallbackModel: "openai/gpt-5.6-luna" });
  });

  it("an agent without a name or with wrong data is not saved and each error is explained next to its field", async () => {
    const error = await errorOf(
      createAgent(owner, {
        name: "  ",
        temperature: 3,
        maxOutputTokens: 5,
        reasoningEffort: "extremo",
        systemTools: ["borrar_base_de_datos"],
        instructions: { role: "x".repeat(4_001) },
        handoff: { unknownThreshold: 9 },
      }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fieldErrors ?? {};
    expect(Object.keys(fields).sort()).toEqual(
      ["handoff.unknownThreshold", "instructions.role", "maxOutputTokens", "name", "reasoningEffort", "systemTools.0", "temperature"].sort(),
    );
    expect(fields.name).toEqual(["Escribe el nombre del agente."]);
    expect(await db.select().from(agents)).toHaveLength(0);
  });

  it.each(SECTORS)("the %s template gives an editable agent with its instructions and hand-off rules", async (sector) => {
    const template = getSectorPreset(sector).agentTemplate;
    const agent = await createAgentFromTemplate(owner, sector);
    expect(agent).toMatchObject({
      name: template.name,
      description: template.description,
      tone: template.tone,
      instructions: template.instructions,
      templateSector: sector,
      handoff: {
        keywords: template.handoff.keywords,
        sensitiveTopics: template.handoff.sensitiveTopics,
        unknownThreshold: template.handoff.unknownThreshold,
        messageInHours: template.handoff.messageInHours,
        messageOffHours: template.handoff.messageOffHours,
      },
    });
    const edited = await updateAgent(owner, agent.id, { name: "Mi asistente" });
    expect(edited.name).toBe("Mi asistente");
  });

  it("«a quién avisar» only accepts active people of the installation", async () => {
    const person = await createUser("supervisor");
    const agent = await createAgent(owner, { name: "Recepción", handoff: { notifyUserIds: [person.userId] } });
    expect(agent.handoff.notifyUserIds).toEqual([person.userId]);
    const error = await errorOf(updateAgent(owner, agent.id, { handoff: { notifyUserIds: [crypto.randomUUID()] } }));
    expect((error as ValidationError).fieldErrors).toHaveProperty(["handoff.notifyUserIds"]);
  });
});

describe("editing and model checks [MOD-05] [MOD-06] [MOD-07]", () => {
  it("every save is a new version with who and when; untouched fields stay", async () => {
    const agent = await createAgent(owner, { name: "Recepción", tone: "Cercano" });
    const updated = await updateAgent(admin, agent.id, {
      instructions: { role: "Atiendes la recepción.", style: "", freeText: "Trata de tú." },
      temperature: 0.4,
      reasoningEffort: "medium",
      maxOutputTokens: 1500,
      knowledgeMode: "always",
    });
    expect(updated).toMatchObject({
      tone: "Cercano",
      instructions: { role: "Atiendes la recepción.", freeText: "Trata de tú." },
      temperature: 0.4,
      reasoningEffort: "medium",
      maxOutputTokens: 1500,
      knowledgeMode: "always",
      currentVersion: 2,
    });
    expect(updated.instructions).not.toHaveProperty("style");
    const versions = await listAgentVersions(owner, agent.id);
    expect(versions.map((version) => [version.version, version.createdByName, version.current])).toEqual([
      [2, "Ana Admin", true],
      [1, "Lola Propietaria", false],
    ]);
  });

  it("the fallback must be of another provider, with or without a catalogue", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    const error = await errorOf(updateAgent(owner, agent.id, { fallbackModel: "openai/gpt-6-luna" }));
    expect((error as ValidationError).fieldErrors).toEqual({ fallbackModel: ["El modelo de respaldo tiene que ser de otro proveedor."] });
    expect((await getAgent(owner, agent.id)).currentVersion).toBe(1);
  });

  it("with the cached catalogue, a chosen model must exist, support tools and not be free or retiring", async () => {
    await cacheCatalog();
    const agent = await createAgent(owner, { name: "Recepción" });
    const modelError = async (model: string) =>
      ((await errorOf(updateAgent(owner, agent.id, { model }))) as ValidationError | null)?.fieldErrors?.model?.[0];
    expect(await modelError("openai/no-existe")).toMatch(/no está en la lista/);
    expect(await modelError("meta/llama-no-tools")).toMatch(/herramientas/);
    expect(await modelError("qwen/qwen3.8-27b:free")).toMatch(/gratuitos/);
    expect(await modelError("deepseek/deepseek-v3.2")).toMatch(/se retira/);
    expect((await updateAgent(owner, agent.id, { model: "anthropic/claude-haiku-4.5" })).model).toBe("anthropic/claude-haiku-4.5");
  });

  it("a model that starts to retire is flagged elsewhere but does not block editing other fields", async () => {
    const agent = await createAgent(owner, { name: "Recepción", model: "deepseek/deepseek-v3.2" });
    await cacheCatalog();
    expect((await updateAgent(owner, agent.id, { name: "Recepción 2" })).name).toBe("Recepción 2");
  });

  it("an unknown agent is «not found»", async () => {
    expect(await errorOf(updateAgent(owner, crypto.randomUUID(), { name: "x" }))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(getAgent(owner, "no-es-un-id"))).toBeInstanceOf(NotFoundError);
  });
});

describe("versions [AGE-12]", () => {
  it("restoring an old version saves it as a new one", async () => {
    const agent = await createAgent(owner, { name: "Recepción", instructions: { role: "Versión uno" } });
    await updateAgent(owner, agent.id, { name: "Recepción nueva", instructions: { role: "Versión dos" } });
    expect(await getAgentVersion(owner, agent.id, 1)).toMatchObject({ name: "Recepción", instructions: { role: "Versión uno" } });
    const restored = await restoreAgentVersion(admin, agent.id, 1);
    expect(restored).toMatchObject({ name: "Recepción", instructions: { role: "Versión uno" }, currentVersion: 3 });
    expect((await listAgentVersions(owner, agent.id)).map((version) => version.version)).toEqual([3, 2, 1]);
    expect(await errorOf(restoreAgentVersion(owner, agent.id, 9))).toBeInstanceOf(NotFoundError);
  });
});

describe("duplicate", () => {
  it("the copy gets its own avatar file: deleting the original does not break it", async () => {
    const { storage, files } = memoryStorage();
    const agent = await saveAgentAvatar(owner, (await createAgent(owner, { name: "Recepción" })).id, { bytes: PNG }, storage);
    const copy = await duplicateAgent(owner, agent.id, storage);
    expect(copy.avatarFileKey).toMatch(/^avatars\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    expect(copy.avatarFileKey).not.toBe(agent.avatarFileKey);
    expect(files.get(copy.avatarFileKey ?? "")).toEqual(PNG);
    await deleteAgent(owner, agent.id, { storage });
    expect([...files.keys()]).toEqual([copy.avatarFileKey]);
  });

  it("copies the configuration and context files as a new agent at version 1", async () => {
    const agent = await createAgent(owner, { name: "Recepción", instructions: { role: "Hola" } });
    await db.insert(agentContextFiles).values({ agentId: agent.id, title: "Tarifas", contentMd: "Corte 25 €", tokenCount: 5 });
    const copy = await duplicateAgent(owner, agent.id);
    expect(copy).toMatchObject({ name: "Copia de Recepción", instructions: { role: "Hola" }, currentVersion: 1 });
    expect(copy.id).not.toBe(agent.id);
    expect(await db.select({ title: agentContextFiles.title }).from(agentContextFiles).where(eq(agentContextFiles.agentId, copy.id))).toEqual([
      { title: "Tarifas" },
    ]);
  });
});

describe("delete [AGE-13]", () => {
  it("deletes the originals of its context files, except one a duplicated copy still uses [CON-01] [AGE-16]", async () => {
    const { storage, files } = memoryStorage();
    const own = "context-files/2026/09/1a1a1a1a-aaaa-4bbb-8ccc-123456789abc.md";
    const shared = "context-files/2026/09/2b2b2b2b-aaaa-4bbb-8ccc-123456789abc.docx";
    for (const key of [own, shared]) await storage.put(key, PNG, "text/markdown");
    const agent = await createAgent(owner, { name: "Recepción" });
    const copy = await createAgent(owner, { name: "Copia de Recepción" });
    await db.insert(agentContextFiles).values([
      { agentId: agent.id, title: "Notas", contentMd: "Notas", tokenCount: 2, sourceFileKey: own },
      { agentId: agent.id, title: "Tarifas", contentMd: "Tarifas", tokenCount: 2, sourceFileKey: shared },
      { agentId: copy.id, title: "Tarifas", contentMd: "Tarifas", tokenCount: 2, sourceFileKey: shared },
    ]);
    await deleteAgent(owner, agent.id, { storage });
    expect([...files.keys()]).toEqual([shared]);
  });

  it("is refused while the agent is active in a channel, unless the person confirms; then those channels stay without agent", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    const channel = await createChannel({ name: "Web principal", activeAgentId: agent.id });
    const [conversation] = await db.insert(conversations).values({ channelId: channel.id, agentOverrideId: agent.id }).returning();
    await db.insert(messages).values({
      conversationId: conversation.id,
      channelId: channel.id,
      direction: "outbound",
      senderType: "ai",
      agentId: agent.id,
      agentName: "Recepción",
      text: "¡Hola!",
      status: "sent",
    });

    const refused = await errorOf(deleteAgent(owner, agent.id));
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).userMessage).toMatch(/Web principal/);
    expect(await db.select().from(agents).where(eq(agents.id, agent.id))).toHaveLength(1);

    const result = await deleteAgent(owner, agent.id, { confirmActiveChannels: true });
    expect(result.detachedChannelIds).toEqual([channel.id]);
    expect(await db.select().from(agents).where(eq(agents.id, agent.id))).toHaveLength(0);
    expect(await versionCount(agent.id)).toBe(0);
    const [after] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(after.activeAgentId).toBeNull();
    const [message] = await db.select().from(messages).where(eq(messages.conversationId, conversation.id));
    expect(message).toMatchObject({ agentId: null, agentName: "Recepción" });
  });

  it("an agent active nowhere is deleted straight away", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    expect(await deleteAgent(admin, agent.id)).toEqual({ detachedChannelIds: [] });
  });
});

describe("avatar", () => {
  it("accepts PNG, JPG or WebP by content, saves a version and deletes the old file", async () => {
    const { storage, files } = memoryStorage();
    const agent = await createAgent(owner, { name: "Recepción" });
    const first = await saveAgentAvatar(owner, agent.id, { bytes: PNG }, storage);
    expect(first.avatarFileKey).toMatch(/^avatars\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    expect(first.currentVersion).toBe(2);
    const second = await saveAgentAvatar(owner, agent.id, { bytes: PNG }, storage);
    expect([...files.keys()]).toEqual([second.avatarFileKey]);

    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    expect(await errorOf(saveAgentAvatar(owner, agent.id, { bytes: svg }, storage))).toBeInstanceOf(ValidationError);

    const removed = await removeAgentAvatar(owner, agent.id, storage);
    expect(removed.avatarFileKey).toBeNull();
    expect(files.size).toBe(0);
  });

  it("only who may see agents can open an avatar", async () => {
    const { storage } = memoryStorage();
    const agent = await saveAgentAvatar(owner, (await createAgent(owner, { name: "Recepción" })).id, { bytes: PNG }, storage);
    const key = agent.avatarFileKey ?? "";
    expect(await canViewAgentAvatar(actorFor("viewer"), key)).toBe(true);
    expect(await canViewAgentAvatar(actorFor("agent"), key)).toBe(false);
    expect(await canViewAgentAvatar(owner, "avatars/2026/09/otro.png")).toBe(false);
    expect(await canViewAgentAvatar(owner, "logos/2026/09/logo.png")).toBe(false);
  });
});

describe("a new agent's models are checked too, also when they come from Ajustes › IA [MOD-05] [ASI-08]", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a default model that is not in the list is explained as a form message, and nothing is created", async () => {
    await cacheCatalog();
    await db.update(integrationSettings).set({ defaultModels: { chat: "no-existe/modelo" } });
    for (const attempt of [createAgent(owner, { name: "Recepción" }), createAgentFromTemplate(owner, "taller", { name: "Recepción del taller" })]) {
      const error = await errorOf(attempt);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).userMessage).toMatch(
        /^El modelo por defecto de Ajustes › IA \(no-existe\/modelo\) no sirve para un agente: este modelo no está en la lista de OpenRouter/,
      );
    }
    await db.update(integrationSettings).set({ defaultModels: { fallback: "meta/llama-no-tools" } });
    expect(((await errorOf(createAgent(owner, { name: "Recepción" }))) as ValidationError).userMessage).toMatch(/\(meta\/llama-no-tools\).*herramientas/);
    expect(await db.select().from(agents)).toHaveLength(0);
  });

  it("without a saved list, OpenRouter's is asked with the key before saving; without a key only the rules that need no list apply", async () => {
    const created = await createAgent(owner, { name: "Sin clave", model: "meta/llama-no-tools" });
    expect(created.model).toBe("meta/llama-no-tools");

    vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
    vi.stubGlobal("fetch", fake.fetch);
    const error = await errorOf(updateAgent(owner, created.id, { model: "qwen/qwen3.8-27b:free" }));
    expect((error as ValidationError).fieldErrors?.model?.[0]).toMatch(/gratuitos/);
    expect(fake.calls.map((call) => call.path)).toEqual(["/models/user"]);
    expect((await updateAgent(owner, created.id, { model: "anthropic/claude-haiku-4.5" })).model).toBe("anthropic/claude-haiku-4.5");
    // The list is kept: asked once.
    expect(fake.calls).toHaveLength(1);
  });

  it("the model fields explain in Spanish what is missing, even for a crafted request", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    const error = await errorOf(updateAgent(owner, agent.id, { fallbackModel: null, model: 7 }));
    expect((error as ValidationError).fieldErrors).toEqual({
      model: ["Elige el modelo principal."],
      fallbackModel: ["Elige un modelo de respaldo de otro proveedor."],
    });
  });
});

describe("restoring a version is a save like any other [AGE-12] [MOD-05] [AGE-09]", () => {
  it("a model that retires since then, or a person disabled since then, is not brought back", async () => {
    const person = await createUser("supervisor");
    const agent = await createAgent(owner, { name: "Recepción", model: "deepseek/deepseek-v3.2", handoff: { notifyUserIds: [person.userId] } });
    await updateAgent(owner, agent.id, { model: "anthropic/claude-haiku-4.5", handoff: {} });
    await cacheCatalog();

    const retiring = await errorOf(restoreAgentVersion(owner, agent.id, 1));
    expect(retiring).toBeInstanceOf(ValidationError);
    expect((retiring as ValidationError).userMessage).toMatch(/^No se puede recuperar la versión 1: este modelo se retira/);
    expect((await getAgent(owner, agent.id)).currentVersion).toBe(2);

    await updateAgent(owner, agent.id, { handoff: { notifyUserIds: [person.userId] } });
    await updateAgent(owner, agent.id, { handoff: {} });
    await db.update(userRoles).set({ disabledAt: new Date() }).where(eq(userRoles.userId, person.userId));
    const disabled = await errorOf(restoreAgentVersion(owner, agent.id, 3));
    expect((disabled as ValidationError).fieldErrors).toHaveProperty(["handoff.notifyUserIds"]);
    expect((await getAgent(owner, agent.id)).currentVersion).toBe(4);
  });

  it("an avatar replaced since then no longer has its file: the current one stays", async () => {
    const { storage, files } = memoryStorage();
    const agent = await createAgent(owner, { name: "Recepción" });
    const first = await saveAgentAvatar(owner, agent.id, { bytes: PNG }, storage);
    const second = await saveAgentAvatar(owner, agent.id, { bytes: PNG }, storage);
    expect(files.has(first.avatarFileKey ?? "")).toBe(false);
    const restored = await restoreAgentVersion(owner, agent.id, first.currentVersion, storage);
    expect(restored.avatarFileKey).toBe(second.avatarFileKey);
  });
});

describe("«a quién avisar» [AGE-09] [PER-02]", () => {
  it("never a read-only person: they cannot act on a hand-off", async () => {
    const viewer = await createUser("viewer");
    const error = await errorOf(createAgent(owner, { name: "Recepción", handoff: { notifyUserIds: [viewer.userId] } }));
    expect((error as ValidationError).fieldErrors).toHaveProperty(["handoff.notifyUserIds"]);
    expect(await db.select().from(agents)).toHaveLength(0);
  });
});

describe("who can do what with agents [PER-01] [SEG-04]", () => {
  it("owner, admin, supervisor and viewer see agents, versions and the channels where they are active; an Agent does not", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    await createChannel({ name: "Web", activeAgentId: agent.id });
    for (const role of ["owner", "admin", ...viewers] as Role[]) {
      const [item] = await listAgents(actorFor(role));
      expect(item).toMatchObject({ id: agent.id, activeChannels: [{ name: "Web", type: "webchat" }] });
      expect((await getAgent(actorFor(role), agent.id)).id).toBe(agent.id);
      expect(await listAgentVersions(actorFor(role), agent.id)).toHaveLength(1);
    }
    for (const call of [listAgents(actorFor("agent")), getAgent(actorFor("agent"), agent.id), listAgentVersions(actorFor("agent"), agent.id)]) {
      expect(await errorOf(call)).toBeInstanceOf(AuthError);
    }
  });

  it.each(notManagers)("%s cannot create, edit, restore, duplicate, delete or change the avatar, and nothing changes", async (role) => {
    const actor = actorFor(role);
    const agent = await createAgent(owner, { name: "Recepción" });
    const { storage } = memoryStorage();
    const attempts = [
      createAgent(actor, { name: "Otro" }),
      createAgentFromTemplate(actor, "peluqueria"),
      updateAgent(actor, agent.id, { name: "Cambiado" }),
      restoreAgentVersion(actor, agent.id, 1),
      duplicateAgent(actor, agent.id),
      deleteAgent(actor, agent.id, { confirmActiveChannels: true }),
      saveAgentAvatar(actor, agent.id, { bytes: PNG }, storage),
      removeAgentAvatar(actor, agent.id, storage),
    ];
    for (const attempt of attempts) expect(await errorOf(attempt)).toBeInstanceOf(AuthError);
    const rows = await db.select().from(agents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Recepción", currentVersion: 1 });
  });

  it("owner, admin and supervisor can test an agent; Agent and viewer cannot [PER-01]", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    for (const role of ["owner", "admin", "supervisor"] as Role[]) {
      expect((await getAgentForTesting(actorFor(role), agent.id)).id).toBe(agent.id);
    }
    for (const role of ["agent", "viewer"] as Role[]) {
      expect(await errorOf(getAgentForTesting(actorFor(role), agent.id))).toBeInstanceOf(AuthError);
    }
  });
});
