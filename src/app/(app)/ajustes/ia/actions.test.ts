import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, integrationSettings } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { OpenRouterKeyCheck } from "@/lib/openrouter/key";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import type { Actor } from "@/lib/permissions";
import { createBusiness, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  checkedKeys: [] as string[],
  check: { valid: true, info: {}, summary: "Clave válida", details: ["Sin tope de gasto"], warnings: [] } as unknown as OpenRouterKeyCheck,
}));
vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/openrouter/key", () => ({
  checkOpenRouterKey: async (key: string) => {
    state.checkedKeys.push(key);
    return state.check;
  },
}));

import { removeAiSecretAction, saveAiSettingsAction, testOpenRouterKeyAction } from "./actions";
import { loadAiSettingsView } from "./_lib/view";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const OPENROUTER_KEY = "sk-or-v1-secreta-de-prueba-9f8e7d6c5b4a1234";
const MISTRAL_KEY = "mistral-secreta-de-prueba-5678";

const validForm = (extra: Record<string, string> = {}) => {
  const data = new FormData();
  const values: Record<string, string> = {
    chat: "openai/gpt-5.6-luna",
    transcription: "openai/whisper-large-v3-turbo",
    embeddings: "openai/text-embedding-3-small",
    imageDescription: "google/gemini-3.1-flash-lite",
    recommendedModels: "openai/gpt-5.6-luna\ngoogle/gemini-3.1-flash-lite\n",
    ...extra,
  };
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
};

async function stored() {
  const [row] = await db.select().from(integrationSettings);
  return row;
}

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await createBusiness();
  owner = await createUser("owner");
  admin = await createUser("admin");
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  state.actor = owner.actor;
  state.checkedKeys.length = 0;
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, mistralKeyEnc: null, defaultModels: {}, recommendedModels: [], zdr: false });
  await db.delete(auditLog);
});

describe("Ajustes › IA: what the page receives [AJU-04] [AJU-16] [SEG-02] [PER-07]", () => {
  it("keys are saved encrypted and the page only gets them masked", async () => {
    expect(await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY, mistralKey: MISTRAL_KEY }))).toMatchObject({ ok: true });
    const row = await stored();
    expect(row.openrouterKeyEnc).not.toContain(OPENROUTER_KEY);
    expect(row.mistralKeyEnc).not.toContain(MISTRAL_KEY);

    const view = await loadAiSettingsView(admin.actor);
    expect(view.openrouterKey).toEqual({ configured: true, masked: "••••1234", readable: true, source: "settings" });
    expect(view.mistralKey).toEqual({ configured: true, masked: "••••5678", readable: true });
    const json = JSON.stringify(view);
    expect(json).not.toContain(OPENROUTER_KEY);
    expect(json).not.toContain(MISTRAL_KEY);
    expect(json).not.toContain("smtp");
  });

  it("says when the key comes from OPENROUTER_API_KEY, without sending it; the one in Ajustes wins [ARR-15]", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-clave-del-entorno-0000abcd");
    const fromEnv = await loadAiSettingsView(owner.actor);
    expect(fromEnv.openrouterKey).toMatchObject({ configured: true, source: "env", masked: "••••abcd" });
    expect(JSON.stringify(fromEnv)).not.toContain("sk-or-v1-clave-del-entorno-0000abcd");

    await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY }));
    expect((await loadAiSettingsView(owner.actor)).openrouterKey).toMatchObject({ source: "settings", masked: "••••1234" });
  });

  it("shows the documented default models until they are changed", async () => {
    const view = await loadAiSettingsView(owner.actor);
    expect(view.models).toEqual({
      chat: DEFAULT_MODELS.chat,
      transcription: DEFAULT_MODELS.transcription,
      embeddings: DEFAULT_MODELS.embeddings,
      imageDescription: DEFAULT_MODELS.imageDescription,
    });
    expect(view.recommendedModels.length).toBeGreaterThan(0);
    expect(view.zdr).toBe(false);
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("Ajustes › IA as %s [PER-03] [PER-04] [SEG-04]", (role) => {
  it("sees no key, not even masked, and cannot change or test anything", async () => {
    await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY }));
    await db.delete(auditLog);
    const before = await stored();
    const person = await createUser(role);
    state.actor = person.actor;

    await expect(loadAiSettingsView(person.actor)).rejects.toMatchObject({ status: 403 });
    expect(await saveAiSettingsAction(null, validForm({ openrouterKey: "sk-or-v1-intruso-000000000000", zdr: "on" }))).toEqual(FORBIDDEN);
    expect(await removeAiSecretAction({ secret: "openrouterKey" })).toEqual(FORBIDDEN);
    const test = new FormData();
    expect(await testOpenRouterKeyAction(null, test)).toEqual(FORBIDDEN);
    expect(state.checkedKeys).toEqual([]);
    expect(await stored()).toEqual(before);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("Ajustes › IA actions", () => {
  it("saves models, recommended list and ZDR, and logs the change without values [SEG-10]", async () => {
    const result = await saveAiSettingsAction(
      null,
      validForm({ chat: "google/gemini-3.1-flash-lite", recommendedModels: " openai/gpt-5.6-luna \n\nqwen/qwen3-reranker-8b", zdr: "on" }),
    );
    expect(result).toMatchObject({ ok: true });
    const row = await stored();
    expect(row.defaultModels).toMatchObject({ chat: "google/gemini-3.1-flash-lite", embeddings: "openai/text-embedding-3-small" });
    expect(row.recommendedModels).toEqual(["openai/gpt-5.6-luna", "qwen/qwen3-reranker-8b"]);
    expect(row.zdr).toBe(true);
    const [entry] = await db.select().from(auditLog);
    expect(entry.action).toBe("settings.integrations_updated");
  });

  it("an empty secret field keeps the saved key; «Quitar» removes it [AJU-16]", async () => {
    await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY }));
    await saveAiSettingsAction(null, validForm({ openrouterKey: "" }));
    expect((await loadAiSettingsView(owner.actor)).openrouterKey).toMatchObject({ configured: true, masked: "••••1234" });
    expect(await removeAiSecretAction({ secret: "openrouterKey" })).toMatchObject({ ok: true });
    expect((await loadAiSettingsView(owner.actor)).openrouterKey).toMatchObject({ configured: false, source: null });
    expect(await removeAiSecretAction({ secret: "other" as "openrouterKey" })).toMatchObject({ ok: false });
  });

  it("explains wrong values next to each field and saves nothing [AJU-15] [SEG-05]", async () => {
    const result = await saveAiSettingsAction(
      null,
      validForm({ chat: "", transcription: "whisper sin proveedor", recommendedModels: "openai/gpt-5.6-luna\nno válido" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["chat", "recommendedModels", "transcription"]);
    expect(result.fieldErrors?.chat?.[0]).toMatch(/modelo/i);
    expect((await stored()).defaultModels).toEqual({});
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("warns that a new embeddings model means processing the knowledge again [AJU-05]", async () => {
    const result = await saveAiSettingsAction(null, validForm({ embeddings: "openai/text-embedding-3-large" }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.message).toMatch(/volver a procesar/);
  });

  it("«Probar clave» tests the key being typed, or else the saved one, and never returns it [ASI-07] [AJU-04]", async () => {
    const typed = new FormData();
    typed.append("openrouterKey", ` ${OPENROUTER_KEY} `);
    expect(await testOpenRouterKeyAction(null, typed)).toEqual({
      ok: true,
      data: { valid: true, summary: "Clave válida", details: ["Sin tope de gasto"], warnings: [] },
    });
    expect(state.checkedKeys).toEqual([OPENROUTER_KEY]);

    const empty = new FormData();
    expect(await testOpenRouterKeyAction(null, empty)).toEqual({
      ok: false,
      error: "Todavía no hay ninguna clave: escríbela y pruébala.",
    });

    await saveAiSettingsAction(null, validForm({ openrouterKey: "sk-or-v1-guardada-0000000000009999" }));
    state.check = { valid: false, reason: "invalid", message: "La clave de OpenRouter no es válida o ha caducado." };
    const result = await testOpenRouterKeyAction(null, empty);
    expect(result).toEqual({ ok: true, data: { valid: false, message: "La clave de OpenRouter no es válida o ha caducado." } });
    expect(state.checkedKeys.at(-1)).toBe("sk-or-v1-guardada-0000000000009999");
    expect(JSON.stringify(result)).not.toContain("sk-or-v1-guardada");
  });

  it("«Probar clave» is rate limited per person [SEG-07]", async () => {
    const typed = new FormData();
    typed.append("openrouterKey", OPENROUTER_KEY);
    state.actor = admin.actor;
    for (let i = 0; i < 10; i++) await testOpenRouterKeyAction(null, typed);
    expect(await testOpenRouterKeyAction(null, typed)).toEqual({ ok: false, error: "Demasiados intentos. Espera un minuto y vuelve a probar." });
  });
});
