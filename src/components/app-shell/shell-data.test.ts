import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { updateIntegrationSettings } from "@/data/settings";
import { db } from "@/db";
import { agentMembers, agents } from "@/db/schema";
import { primaryStyleSheet } from "@/lib/color";
import type { Actor } from "@/lib/permissions";
import { actorFor, createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createUser } from "@/test/factories";
import { loadShellData } from "./shell-data";

const OWNER_EXTRA = { email: "ana@example.com", sessionId: "s", isDemo: false, twoFactorEnabled: false, twoFactorSetupRequired: false };

describe("loadShellData", () => {
  it("[AJU-01] the panel shows the business name, logo (through the files route) and colour", async () => {
    await createBusiness({ name: "Peluquería Ana", logoFileKey: "logos/2026/09/logo.png", color: "#1e2a4a" });
    const shell = await loadShellData({ ...actorFor("owner", { name: "Ana Pérez" }), ...OWNER_EXTRA });

    expect(shell.business).toEqual({ name: "Peluquería Ana", initials: "PA", logoUrl: "/api/files/logos/2026/09/logo.png" });
    expect(shell.brandStyleSheet).toBe(primaryStyleSheet("#1e2a4a"));
    expect(shell.user).toEqual({ name: "Ana Pérez", email: "ana@example.com", roleLabel: "Propietario" });
  });

  it("[AJU-01] without a name or logo it shows «DominIA Agentes» and its initials", async () => {
    await createBusiness({ name: "", logoFileKey: null });
    const shell = await loadShellData({ ...actorFor("viewer"), ...OWNER_EXTRA });
    expect(shell.business).toEqual({ name: "DominIA Agentes", initials: "DA", logoUrl: null });
  });

  it("[ARR-14] without an OpenRouter key owners get the button and other roles the softer notice", async () => {
    await createBusiness();
    expect((await loadShellData({ ...actorFor("admin"), ...OWNER_EXTRA })).openRouterNotice).toBe("manage");
    expect((await loadShellData({ ...actorFor("agent"), ...OWNER_EXTRA })).openRouterNotice).toBe("ask");
  });

  it("[ARR-15] [SEG-02] with a key the notice goes away and the key never reaches the shell data", async () => {
    await createBusiness();
    // A real user: the change is written to the activity log, which references the user.
    const owner = { ...(await createUser("owner")).actor, ...OWNER_EXTRA };
    await updateIntegrationSettings(owner, { openrouterKey: "sk-or-v1-clave-secreta-de-prueba-1234" });
    const shell = await loadShellData(owner);
    expect(shell.openRouterNotice).toBeNull();
    expect(JSON.stringify(shell)).not.toContain("clave-secreta");
  });

  it("[BAN-03] [PER-02] «Bandeja» counts the unread conversations of the person's channels", async () => {
    await createBusiness();
    const web = await createChannel({ name: "Web" });
    const whatsapp = await createChannel({ name: "WhatsApp", type: "whatsapp", isDemo: true });
    const ana = await createContactWithIdentity("webchat");
    const bruno = await createContactWithIdentity("whatsapp");
    await createConversation(web.id, ana.contact.id, { unreadCount: 2 });
    await createConversation(whatsapp.id, bruno.contact.id, { unreadCount: 1 });
    await createConversation(web.id, bruno.contact.id, { unreadCount: 0 });
    expect((await loadShellData({ ...actorFor("owner"), ...OWNER_EXTRA })).inboxUnread).toBe(2);
    expect((await loadShellData({ ...actorFor("viewer"), ...OWNER_EXTRA })).inboxUnread).toBe(2);
    expect((await loadShellData({ ...actorFor("agent", { channelIds: [web.id] }), ...OWNER_EXTRA })).inboxUnread).toBe(1);
  });

  it("[PER-01] only the sections of the role reach the menus", async () => {
    await createBusiness();
    const shell = await loadShellData({ ...actorFor("agent"), ...OWNER_EXTRA });
    expect(shell.sectionKeys).toEqual(["bandeja", "contactos", "agenda", "ajustes"]);
  });
});

describe("«Asistentes» in the menu [INT-06]", () => {
  it("reaches the menu of who has an internal agent to use, and of nobody else", async () => {
    await createBusiness();
    const internal = await createAgentRow({ audience: "team", teamAccess: "selected", systemTools: [] });
    const agent = await createUser("agent");
    const supervisor = await createUser("supervisor");
    const keysOf = async (actor: Actor) => (await loadShellData({ ...actor, ...OWNER_EXTRA })).sectionKeys;

    // Only owner and admin use a new internal agent.
    expect(await keysOf(actorFor("owner"))).toContain("asistentes");
    expect(await keysOf(agent.actor)).not.toContain("asistentes");

    await db.insert(agentMembers).values({ agentId: internal.id, userId: agent.userId });
    expect(await keysOf(agent.actor)).toContain("asistentes");
    expect(await keysOf(supervisor.actor)).not.toContain("asistentes");

    await db.update(agents).set({ teamAccess: "everyone" }).where(eq(agents.id, internal.id));
    expect(await keysOf(supervisor.actor)).toContain("asistentes");
    expect(await keysOf(actorFor("viewer"))).not.toContain("asistentes");
  });
});
