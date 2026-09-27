// Canales ([CAN-01]–[CAN-08], [CAN-16], [WEB-01], [WEB-02], [WEB-07], [WEB-10], [AGE-10], [USU-17]): the Server Actions of
// the channel cards, the web chat wizard and the channel panel, called directly as an attacker could ([SEG-04]). The
// session is replaced; the data layer and the database are real. Files go to an in-memory store.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, channelMembers, channels } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { readWebchatConfig } from "@/lib/webchat-config";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  files: new Map<string, Uint8Array>(),
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
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  return {
    ...original,
    getFileStorage: () => ({
      kind: "disk" as const,
      async put(key: string, data: Uint8Array) {
        state.files.set(key, data);
        return { key, size: data.byteLength };
      },
      async get() {
        return null;
      },
      async delete(key: string) {
        state.files.delete(key);
      },
      async exists(key: string) {
        return state.files.has(key);
      },
    }),
  };
});

import { canViewWebchatLogo } from "@/data/webchat-logo";
import {
  createWebchatChannelAction,
  deleteChannelAction,
  removeWebchatLogoAction,
  saveChannelSettingsAction,
  saveWebchatAppearanceAction,
  setChannelActiveAgentAction,
  setChannelAiAction,
  setChannelEnabledAction,
  setChannelMembersAction,
  uploadWebchatLogoAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const SIGNED_OUT = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const LOOK = {
  color: "#e11d48",
  welcomeMessage: "¡Hola! ¿En qué te ayudamos?",
  position: "left",
  legalText: "Al escribir aceptas nuestra política de privacidad.",
  allowedDomains: ["www.mipeluqueria.es", "mipeluqueria.es"],
  voiceEnabled: true,
  imagesEnabled: false,
};

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await createBusiness({ name: "Peluquería Prueba", sector: "peluqueria" });
  owner = await createUser("owner", { name: "Lola Propietaria" });
  admin = await createUser("admin", { name: "Ana Admin" });
});

beforeEach(async () => {
  state.actor = owner.actor;
  state.files.clear();
  await db.delete(channelMembers);
  await db.delete(auditLog);
});

async function channelRow(id: string) {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row;
}

/** The wizard's form as the browser sends it: everything but the logo as JSON in `payload`. */
function webchatForm(payload: unknown, logo?: Uint8Array<ArrayBuffer>): FormData {
  const data = new FormData();
  data.append("payload", JSON.stringify(payload));
  if (logo) data.append("logo", new File([logo], "logo.png", { type: "image/png" }));
  return data;
}

function logoForm(bytes: Uint8Array<ArrayBuffer>, type = "image/png"): FormData {
  const data = new FormData();
  data.append("logo", new File([bytes], "logo.png", { type }));
  return data;
}

describe("Tarjeta del canal: agente activo [CAN-03] [CAN-04] [CAN-05] [AGE-10]", () => {
  it("a channel without agent gets the chosen one at once; «Sin agente» leaves it to people", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    const channel = await createChannel({ name: "Chat de la web" });

    const set = await setChannelActiveAgentAction({ channelId: channel.id, agentId: agent.id });
    expect(set).toMatchObject({ ok: true, data: { status: "changed" }, message: "Ahora responde «Recepción» en «Chat de la web»." });
    expect((await channelRow(channel.id)).activeAgentId).toBe(agent.id);

    const cleared = await setChannelActiveAgentAction({ channelId: channel.id, agentId: null });
    expect(cleared).toMatchObject({ ok: true, data: { status: "changed" } });
    expect((await channelRow(channel.id)).activeAgentId).toBeNull();
  });

  it("replacing another agent asks first, naming it, and nothing changes until it is confirmed", async () => {
    const current = await createAgentRow({ name: "Recepción" });
    const next = await createAgentRow({ name: "Ventas" });
    const channel = await createChannel({ name: "WhatsApp Recepción", type: "whatsapp", isDemo: true, activeAgentId: current.id });

    const asked = await setChannelActiveAgentAction({ channelId: channel.id, agentId: next.id });
    expect(asked).toEqual({ ok: true, data: { status: "needs_confirmation", previousAgentName: "Recepción" } });
    expect((await channelRow(channel.id)).activeAgentId).toBe(current.id);
    expect(await db.select().from(auditLog)).toEqual([]);

    const confirmed = await setChannelActiveAgentAction({ channelId: channel.id, agentId: next.id, confirmReplace: true });
    expect(confirmed).toMatchObject({
      ok: true,
      data: { status: "changed" },
      message: "Ahora responde «Ventas» en «WhatsApp Recepción», en lugar de «Recepción».",
    });
    // Still one active agent: the channel keeps a single one, and the agent it replaced is no longer active there.
    expect((await channelRow(channel.id)).activeAgentId).toBe(next.id);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "channel.agent_changed"));
    expect(entry.metadata).toMatchObject({ agentId: next.id, previousAgentId: current.id });
  });

  it("choosing the agent that is already active changes nothing", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    const channel = await createChannel({ activeAgentId: agent.id });
    expect(await setChannelActiveAgentAction({ channelId: channel.id, agentId: agent.id })).toMatchObject({ ok: true, data: { status: "unchanged" } });
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("an agent or a channel that does not exist is refused", async () => {
    const channel = await createChannel();
    expect(await setChannelActiveAgentAction({ channelId: channel.id, agentId: crypto.randomUUID() })).toMatchObject({ ok: false });
    expect(await setChannelActiveAgentAction({ channelId: crypto.randomUUID(), agentId: null })).toMatchObject({ ok: false });
    expect(await setChannelActiveAgentAction({ channelId: "no-es-un-id", agentId: null })).toMatchObject({ ok: false });
    expect((await channelRow(channel.id)).activeAgentId).toBeNull();
  });
});

describe("Tarjeta del canal: IA del canal [CAN-03] [CAN-04]", () => {
  it("turns the channel's AI off and on", async () => {
    const channel = await createChannel({ name: "Chat de la web" });
    expect(await setChannelAiAction({ channelId: channel.id, aiEnabled: false })).toMatchObject({ ok: true });
    expect((await channelRow(channel.id)).aiEnabled).toBe(false);
    expect(await setChannelAiAction({ channelId: channel.id, aiEnabled: true })).toMatchObject({ ok: true });
    expect((await channelRow(channel.id)).aiEnabled).toBe(true);
    expect(await setChannelAiAction({ channelId: channel.id, aiEnabled: "sí" })).toMatchObject({ ok: false });
  });
});

describe("Chat web nuevo [WEB-01] [WEB-02] [WEB-07] [WEB-10] [CAN-07]", () => {
  it("creates it connected and automatic, with its look, domains, agent and AI", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    state.actor = admin.actor;
    const result = await createWebchatChannelAction(webchatForm({ name: "Chat de la web", activeAgentId: agent.id, aiEnabled: true, config: LOOK }));
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) } });
    if (!result.ok || !result.data) throw new Error("no creado");

    const row = await channelRow(result.data.id);
    expect(row).toMatchObject({ type: "webchat", name: "Chat de la web", status: "connected", replyMode: "auto", activeAgentId: agent.id, aiEnabled: true });
    expect(readWebchatConfig(row.config)).toEqual({ ...LOOK, logoFileKey: null });
  });

  it("with a logo, stores it as the chat's logo", async () => {
    const result = await createWebchatChannelAction(webchatForm({ name: "Chat de la web", config: {} }, PNG));
    if (!result.ok || !result.data) throw new Error("no creado");
    const { logoFileKey } = readWebchatConfig((await channelRow(result.data.id)).config);
    expect(logoFileKey).toMatch(/^webchat-logos\//);
    expect(state.files.has(logoFileKey ?? "")).toBe(true);
    expect(await canViewWebchatLogo(owner.actor, logoFileKey ?? "")).toBe(true);
  });

  it("a file key typed into the form never becomes the chat's logo: it only comes from an upload [SEG-04]", async () => {
    const result = await createWebchatChannelAction(webchatForm({ name: "Chat de la web", config: { ...LOOK, logoFileKey: "messages/2026/09/foto-del-cliente.jpg" } }));
    if (!result.ok || !result.data) throw new Error("no creado");
    expect(readWebchatConfig((await channelRow(result.data.id)).config).logoFileKey).toBeNull();
  });

  it("wrong settings are explained next to their field and nothing is created [AJU-15]", async () => {
    const before = (await db.select().from(channels)).length;
    const result = await createWebchatChannelAction(
      webchatForm({ name: "  ", config: { ...LOOK, color: "rojo", allowedDomains: ["https://mipeluqueria.es/contacto"], welcomeMessage: "x".repeat(501) } }),
    );
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });

    const bad = await createWebchatChannelAction(webchatForm({ name: "Chat", config: { ...LOOK, color: "rojo", allowedDomains: ["https://mipeluqueria.es/contacto"] } }));
    expect(bad).toMatchObject({ ok: false, fieldErrors: { color: expect.any(Array), allowedDomains: expect.any(Array) } });
    expect(await createWebchatChannelAction(webchatForm({ name: "Chat", config: { ...LOOK, welcomeMessage: "x".repeat(501) } }))).toMatchObject({
      ok: false,
      fieldErrors: { welcomeMessage: ["Como mucho 500 caracteres."] },
    });
    expect((await db.select().from(channels)).length).toBe(before);
  });

  it("a logo that is not a PNG, JPG or WebP is refused before creating anything [SEG-13]", async () => {
    const before = (await db.select().from(channels)).length;
    const data = new FormData();
    data.append("payload", JSON.stringify({ name: "Chat de la web", config: {} }));
    data.append("logo", new File([SVG], "logo.png", { type: "image/png" }));
    expect(await createWebchatChannelAction(data)).toMatchObject({ ok: false, fieldErrors: { logo: ["El logo tiene que ser una imagen PNG, JPG o WebP."] } });
    expect((await db.select().from(channels)).length).toBe(before);
    expect(state.files.size).toBe(0);
  });

  it("a form that is not JSON is refused without creating anything", async () => {
    const before = (await db.select().from(channels)).length;
    const data = new FormData();
    data.append("payload", "{nombre");
    expect(await createWebchatChannelAction(data)).toMatchObject({ ok: false });
    expect((await db.select().from(channels)).length).toBe(before);
  });
});

describe("Apariencia y código [WEB-02] [WEB-07] [WEB-10]", () => {
  it("saves the look, texts, domains, voice and images, and keeps the logo", async () => {
    const channel = await createChannel({ name: "Chat de la web", config: { logoFileKey: "webchat-logos/2026/09/logo.png" } });
    const result = await saveWebchatAppearanceAction(channel.id, { ...LOOK, logoFileKey: "messages/2026/09/ajeno.png" });
    expect(result).toMatchObject({ ok: true });
    expect(readWebchatConfig((await channelRow(channel.id)).config)).toEqual({ ...LOOK, logoFileKey: "webchat-logos/2026/09/logo.png" });
  });

  it("an empty list of domains means the chat only works inside the app [WEB-10]", async () => {
    const channel = await createChannel({ config: { allowedDomains: ["www.mipeluqueria.es"] } });
    expect(await saveWebchatAppearanceAction(channel.id, { ...LOOK, allowedDomains: [] })).toMatchObject({ ok: true });
    expect(readWebchatConfig((await channelRow(channel.id)).config).allowedDomains).toEqual([]);
  });

  it("wrong values are explained next to their field and nothing changes [AJU-15]", async () => {
    const channel = await createChannel({ config: { color: "#3d6df2" } });
    const result = await saveWebchatAppearanceAction(channel.id, { ...LOOK, position: "arriba", allowedDomains: ["*.mipeluqueria.es"] });
    expect(result).toMatchObject({ ok: false, fieldErrors: { position: expect.any(Array), allowedDomains: expect.any(Array) } });
    expect(await saveWebchatAppearanceAction(channel.id, "no es un objeto")).toMatchObject({ ok: false });
    expect(readWebchatConfig((await channelRow(channel.id)).config).color).toBe("#3d6df2");
  });

  it("only a web chat has this form", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", isDemo: true, config: {} });
    expect(await saveWebchatAppearanceAction(whatsapp.id, LOOK)).toMatchObject({ ok: false, error: "Este canal no es un chat web." });
    expect((await channelRow(whatsapp.id)).config).toEqual({});
  });

  it("a new logo replaces the old one (deleted); removing it goes back to the business logo", async () => {
    const channel = await createChannel({ name: "Chat de la web" });
    expect(await uploadWebchatLogoAction(channel.id, undefined, logoForm(PNG))).toMatchObject({ ok: true });
    const first = readWebchatConfig((await channelRow(channel.id)).config).logoFileKey ?? "";
    expect(await canViewWebchatLogo(owner.actor, first)).toBe(true);

    expect(await uploadWebchatLogoAction(channel.id, undefined, logoForm(PNG))).toMatchObject({ ok: true });
    const second = readWebchatConfig((await channelRow(channel.id)).config).logoFileKey ?? "";
    expect(second).not.toBe(first);
    expect(state.files.has(first)).toBe(false);
    expect(await canViewWebchatLogo(owner.actor, first)).toBe(false);

    expect(await removeWebchatLogoAction(channel.id)).toMatchObject({ ok: true });
    expect(readWebchatConfig((await channelRow(channel.id)).config).logoFileKey).toBeNull();
    expect(state.files.size).toBe(0);
    expect(await canViewWebchatLogo(owner.actor, second)).toBe(false);
  });

  it("a logo that is not an image, or too big, or missing, is refused next to the field [SEG-13]", async () => {
    const channel = await createChannel();
    expect(await uploadWebchatLogoAction(channel.id, undefined, logoForm(SVG, "image/svg+xml"))).toMatchObject({ ok: false, fieldErrors: { logo: expect.any(Array) } });
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(PNG);
    expect(await uploadWebchatLogoAction(channel.id, undefined, logoForm(big))).toMatchObject({ ok: false, fieldErrors: { logo: expect.any(Array) } });
    expect(await uploadWebchatLogoAction(channel.id, undefined, new FormData())).toMatchObject({ ok: false, fieldErrors: { logo: ["Elige una imagen."] } });
    expect(readWebchatConfig((await channelRow(channel.id)).config).logoFileKey).toBeNull();
    expect(state.files.size).toBe(0);
  });

  it("/api/files shows the current logo of a web chat only to who sees Canales, and no other key that way [SEG-04] [PER-04]", async () => {
    const channel = await createChannel();
    expect(await uploadWebchatLogoAction(channel.id, undefined, logoForm(PNG))).toMatchObject({ ok: true });
    const logo = readWebchatConfig((await channelRow(channel.id)).config).logoFileKey ?? "";
    expect(await canViewWebchatLogo(admin.actor, logo)).toBe(true);
    expect(await canViewWebchatLogo((await createUser("viewer")).actor, logo)).toBe(true);
    expect(await canViewWebchatLogo((await createUser("supervisor")).actor, logo)).toBe(false);
    expect(await canViewWebchatLogo((await createUser("agent")).actor, logo)).toBe(false);

    // Whatever a config says, only keys under webchat-logos/ qualify.
    await createChannel({ config: { logoFileKey: "messages/2026/09/foto-del-cliente.jpg" } });
    expect(await canViewWebchatLogo(owner.actor, "messages/2026/09/foto-del-cliente.jpg")).toBe(false);
    expect(await canViewWebchatLogo(owner.actor, "webchat-logos/2026/09/nadie.png")).toBe(false);
  });
});

describe("Configuración del canal [CAN-06] [CAN-07] [CAN-08] [CUM-01]", () => {
  it("name, reply mode, AI notice, off-hours and test mode with its list", async () => {
    const channel = await createChannel({ name: "Chat" });
    const result = await saveChannelSettingsAction(channel.id, {
      name: "Chat de la web",
      replyMode: "draft",
      disclosureMessage: "Te atiende un asistente con IA.",
      offHoursBehavior: "no_reply",
      testMode: true,
      testAllowlist: ["+34600111222", "ana@example.com", "+34600111222"],
    });
    expect(result).toMatchObject({ ok: true, message: "Cambios guardados." });
    expect(await channelRow(channel.id)).toMatchObject({
      name: "Chat de la web",
      replyMode: "draft",
      disclosureMessage: "Te atiende un asistente con IA.",
      offHoursBehavior: "no_reply",
      testMode: true,
      testAllowlist: ["+34600111222", "ana@example.com"],
    });

    // An empty notice goes back to the business default.
    expect(await saveChannelSettingsAction(channel.id, { disclosureMessage: "" })).toMatchObject({ ok: true });
    expect((await channelRow(channel.id)).disclosureMessage).toBeNull();
  });

  it("wrong values are explained next to their field and nothing changes [AJU-15]", async () => {
    const channel = await createChannel({ name: "Chat" });
    const result = await saveChannelSettingsAction(channel.id, { name: "", replyMode: "a veces", testAllowlist: Array.from({ length: 101 }, (_, i) => `+3460000${i}`) });
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array), replyMode: expect.any(Array), testAllowlist: expect.any(Array) } });
    expect(await channelRow(channel.id)).toMatchObject({ name: "Chat", replyMode: "auto", testAllowlist: [] });
  });
});

describe("Personas del canal [USU-17] [PER-02]", () => {
  it("limits people with the Agent role to the channel; the list replaces the previous one", async () => {
    const channel = await createChannel();
    const first = await createUser("agent");
    const second = await createUser("agent");
    expect(await setChannelMembersAction({ channelId: channel.id, userIds: [first.userId, second.userId] })).toMatchObject({ ok: true });
    expect(await setChannelMembersAction({ channelId: channel.id, userIds: [second.userId] })).toMatchObject({ ok: true });
    const rows = await db.select().from(channelMembers).where(eq(channelMembers.channelId, channel.id));
    expect(rows.map((row) => row.userId)).toEqual([second.userId]);
  });

  it("people with another role are refused and nothing changes", async () => {
    const channel = await createChannel();
    const supervisor = await createUser("supervisor");
    expect(await setChannelMembersAction({ channelId: channel.id, userIds: [supervisor.userId] })).toMatchObject({ ok: false, fieldErrors: { userIds: expect.any(Array) } });
    expect(await db.select().from(channelMembers)).toEqual([]);
  });

  it("taking an agent off their last channel, or deleting it, warns the admin that they will now see every channel", async () => {
    const channel = await createChannel();
    const agent = await createUser("agent", { name: "Marta Recepción", channelIds: [channel.id] });
    expect(await setChannelMembersAction({ channelId: channel.id, userIds: [agent.userId] })).toEqual({ ok: true, data: { warning: null }, message: "Cambios guardados." });
    expect(await setChannelMembersAction({ channelId: channel.id, userIds: [] })).toMatchObject({
      ok: true,
      data: { warning: expect.stringMatching(/^«Marta Recepción» ya no tiene ningún canal asignado, así que desde ahora verá todos los canales\./) },
    });
    const only = await createChannel();
    await setChannelMembersAction({ channelId: only.id, userIds: [agent.userId] });
    expect(await deleteChannelAction(only.id)).toMatchObject({ ok: true, message: "Canal borrado.", data: { warning: expect.stringContaining("«Marta Recepción»") } });
  });
});

describe("Desactivar y borrar [CAN-16]", () => {
  it("disabling keeps the channel and its history; enabling a web chat puts it back to «conectado»", async () => {
    const channel = await createChannel();
    const { contact } = await createContactWithIdentity("webchat");
    await createConversation(channel.id, contact.id);
    expect(await setChannelEnabledAction({ channelId: channel.id, enabled: false })).toMatchObject({ ok: true });
    expect((await channelRow(channel.id)).status).toBe("disabled");
    expect(await setChannelEnabledAction({ channelId: channel.id, enabled: true })).toMatchObject({ ok: true });
    expect((await channelRow(channel.id)).status).toBe("connected");
  });

  it("only a channel without conversations can be deleted; the others are disabled instead", async () => {
    const empty = await createChannel();
    const used = await createChannel();
    const { contact } = await createContactWithIdentity("webchat");
    await createConversation(used.id, contact.id);

    expect(await deleteChannelAction(used.id)).toMatchObject({ ok: false, error: expect.stringContaining("desactívalo") });
    expect(await channelRow(used.id)).toBeDefined();
    expect(await deleteChannelAction(empty.id)).toMatchObject({ ok: true });
    expect(await channelRow(empty.id)).toBeUndefined();
  });
});

describe("Sin sesión [SEG-04]", () => {
  it("every action asks to sign in and nothing changes", async () => {
    const channel = await createChannel({ name: "Chat" });
    state.actor = null;
    expect(await setChannelAiAction({ channelId: channel.id, aiEnabled: false })).toEqual(SIGNED_OUT);
    expect(await createWebchatChannelAction(webchatForm({ name: "Intruso", config: {} }))).toEqual(SIGNED_OUT);
    expect(await deleteChannelAction(channel.id)).toEqual(SIGNED_OUT);
    expect(await channelRow(channel.id)).toMatchObject({ name: "Chat", aiEnabled: true });
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("%s no configura canales [PER-03] [PER-04] [SEG-04]", (role) => {
  it("every action is refused and nothing changes", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    const channel = await createChannel({ name: "Chat", config: { color: "#3d6df2" } });
    const member = await createUser("agent");
    const before = await channelRow(channel.id);
    const count = (await db.select().from(channels)).length;
    state.actor = (await createUser(role, role === "agent" ? { channelIds: [channel.id] } : {})).actor;

    expect(await setChannelActiveAgentAction({ channelId: channel.id, agentId: agent.id })).toEqual(FORBIDDEN);
    expect(await setChannelAiAction({ channelId: channel.id, aiEnabled: false })).toEqual(FORBIDDEN);
    expect(await createWebchatChannelAction(webchatForm({ name: "Intruso", config: {} }, PNG))).toEqual(FORBIDDEN);
    expect(await saveWebchatAppearanceAction(channel.id, LOOK)).toEqual(FORBIDDEN);
    expect(await uploadWebchatLogoAction(channel.id, undefined, logoForm(PNG))).toEqual(FORBIDDEN);
    expect(await removeWebchatLogoAction(channel.id)).toEqual(FORBIDDEN);
    expect(await saveChannelSettingsAction(channel.id, { name: "Intruso", testMode: true })).toEqual(FORBIDDEN);
    expect(await setChannelEnabledAction({ channelId: channel.id, enabled: false })).toEqual(FORBIDDEN);
    expect(await setChannelMembersAction({ channelId: channel.id, userIds: [member.userId] })).toEqual(FORBIDDEN);
    expect(await deleteChannelAction(channel.id)).toEqual(FORBIDDEN);

    expect(await channelRow(channel.id)).toEqual(before);
    expect((await db.select().from(channels)).length).toBe(count);
    expect(await db.select().from(channelMembers).where(eq(channelMembers.userId, member.userId))).toEqual([]);
    expect(state.files.size).toBe(0);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});
