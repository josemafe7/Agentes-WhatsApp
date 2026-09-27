// «Descargar CSV» of Informes called directly, as the browser would, with the real data layer and database ([SEG-04],
// [PER-01] «Informes»). The clock is fixed on Sunday 2026-09-27 10:00 (Madrid): only Date is faked (docs/testing.md).
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { auditLog, handoffEvents } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { at, createHairdresser, NOW } from "@/server/booking/test-helpers";
import { createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { exportReportTableAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const READERS = ["owner", "admin", "supervisor", "viewer"] as const;

const signInAs = (person: TestUser) => {
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};
const signInWithRole = async (role: Role) => {
  const person = await createUser(role);
  signInAs(person);
  return person;
};
const exportsOf = (userId: string) => db.select().from(auditLog).where(and(eq(auditLog.action, "report.exported"), eq(auditLog.actorUserId, userId)));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await createHairdresser();
  // One WhatsApp conversation of September with a hand-off whose reason names the customer.
  const channel = await createChannel({ type: "whatsapp", name: "WhatsApp Recepción" });
  const { contact } = await createContactWithIdentity("whatsapp", { name: "Cristina Herrero" });
  const conversation = await createConversation(channel.id, contact.id, { status: "pending_human" });
  const createdAt = at("2026-09-20T10:00");
  await createMessage(conversation, { createdAt, updatedAt: createdAt });
  await db.insert(handoffEvents).values({ conversationId: conversation.id, trigger: "ai_tool", reason: "Cristina Herrero pide su factura", summary: "", requestedAt: at("2026-09-20T10:01") });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  state.session = null;
});

describe("«Descargar CSV» [PER-01] «Informes»", () => {
  it.each(READERS)("[PER-03] the %s downloads a table of the period, as the screen shows it", async (role) => {
    await signInWithRole(role);
    const result = await exportReportTableAction({ table: "canales", filter: { month: "2026-09" } });
    expect(result).toMatchObject({ ok: true, data: { fileName: "informe-conversaciones-por-canal-2026-09.csv" } });
    if (!result.ok || !result.data) return;
    const lines = result.data.csv.split("\r\n");
    expect(lines[0]).toBe('﻿"Canal";"Tipo";"Conversaciones";"Resueltas por la IA";"% resuelto por la IA";"Traspasos";"Citas creadas por la IA"');
    expect(lines[1]).toBe('"WhatsApp Recepción";"WhatsApp";"1";"0";"0";"1";"0"');
    expect(lines[2]).toBe('"Total";"";"1";"0";"0";"1";"0"');
  });

  it("[INF-04] exports the reasons of the hand-offs of a custom range", async () => {
    await signInWithRole("supervisor");
    const result = await exportReportTableAction({ table: "motivos", filter: { from: "2026-09-20", to: "2026-09-20" } });
    expect(result).toMatchObject({ ok: true, data: { fileName: "informe-motivos-de-los-traspasos-2026-09-20_2026-09-20.csv" } });
    if (!result.ok || !result.data) return;
    expect(result.data.csv.split("\r\n")[1]).toBe('"Cristina Herrero pide su factura";"La IA, con su herramienta";"1"');
  });

  it("[PER-02] the agent gets «No tienes permiso» and nothing is exported or logged", async () => {
    const agent = await signInWithRole("agent");
    expect(await exportReportTableAction({ table: "canales", filter: {} })).toEqual(FORBIDDEN);
    expect(await exportsOf(agent.userId)).toHaveLength(0);
  });

  it("[SEG-04] without a session nothing is exported", async () => {
    expect(await exportReportTableAction({ table: "canales", filter: {} })).toMatchObject({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
  });

  it("[SEG-10] each export is written in the activity log with the table and the period, and nothing personal", async () => {
    const viewer = await signInWithRole("viewer");
    await exportReportTableAction({ table: "motivos", filter: { month: "2026-09" } });
    const [entry] = await exportsOf(viewer.userId);
    expect(entry).toMatchObject({ actorType: "user", targetType: "report" });
    expect(entry.metadata).toEqual({ table: "motivos", firstDay: "2026-09-01", lastDay: "2026-09-30", channelFiltered: false });
    expect(JSON.stringify(entry.metadata)).not.toContain("Cristina");
  });

  it.each([
    ["an unknown table", { table: "contactos", filter: {} }],
    ["a wrong period", { table: "canales", filter: { month: "2026-13" } }],
    ["unknown fields", { table: "canales", filter: {}, extra: true }],
    ["something that is not a request", "canales"],
  ])("[SEG-05] refuses %s without exporting anything", async (_label, input) => {
    const owner = await signInWithRole("owner");
    expect(await exportReportTableAction(input)).toMatchObject({ ok: false });
    expect(await exportsOf(owner.userId)).toHaveLength(0);
  });
});
