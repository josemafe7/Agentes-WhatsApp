import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, jobs, systemEmails } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { getJobQueue } from "@/server/adapters/job-queue";
import { createBusiness, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  return {
    requireActor: async () => {
      if (!state.actor) throw new AuthError("unauthenticated");
      return state.actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { cancelJobAction, retryJobAction } from "./actions";
import { loadDiagnosticsView } from "./_lib/view";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };

async function jobWith(values: Partial<typeof jobs.$inferInsert>) {
  const { id } = await getJobQueue().enqueue({ type: "email.sync" });
  await db.update(jobs).set(values).where(eq(jobs.id, id));
  return id;
}

async function statusOf(id: string) {
  const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id));
  return row.status;
}

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await createBusiness();
  owner = await createUser("owner");
  admin = await createUser("admin");
});

beforeEach(async () => {
  state.actor = owner.actor;
  await db.delete(jobs);
  await db.delete(auditLog);
});

describe("Ajustes › Diagnóstico [AJU-11]", () => {
  it("shows the database, the queue with its errors, realtime, webhooks and system emails, ready to display", async () => {
    await jobWith({ status: "failed", attempts: 5, lastError: "No se pudo conectar con el buzón." });
    await db.insert(systemEmails).values({ kind: "invitation", toEmail: "nueva@example.com", subject: "Invitación", transport: "outbox", status: "saved", outboxFile: "a.eml" });

    const view = await loadDiagnosticsView(admin.actor);
    expect(view.database).toMatchObject({ status: "ok", driverLabel: "libSQL · archivo local", migrationsStatus: "ok" });
    expect(view.database.migrationsLabel).toMatch(/^(\d+) de \1 aplicadas$/);
    expect(view.queue.counts).toMatchObject({ failed: 1 });
    expect(view.queue.lastTick).toBeNull();
    expect(view.queue.jobs[0]).toMatchObject({ type: "email.sync", statusLabel: "Fallido", attempts: "5 de 5", error: "No se pudo conectar con el buzón.", canRetry: true });
    expect(view.webhooks.channels).toEqual([]);
    expect(view.emails.outboxEnabled).toBe(true);
    expect(view.emails.items[0]).toMatchObject({ kindLabel: "Invitación", toEmail: "nueva@example.com", statusLabel: "Guardado en la bandeja local", canOpen: true });
  });

  it("owner and admin retry a failed job and cancel one waiting to retry; both are logged", async () => {
    const failed = await jobWith({ status: "failed", lastError: "Fallo" });
    const retrying = await jobWith({ status: "pending", attempts: 2, lastError: "Tiempo agotado" });
    expect(await retryJobAction({ jobId: failed })).toEqual({ ok: true, message: "El trabajo se volverá a intentar ahora." });
    state.actor = admin.actor;
    expect(await cancelJobAction({ jobId: retrying })).toEqual({ ok: true, message: "Trabajo cancelado." });
    expect(await statusOf(failed)).toBe("pending");
    expect(await statusOf(retrying)).toBe("cancelled");
    expect((await db.select({ action: auditLog.action }).from(auditLog)).map((e) => e.action).sort()).toEqual(["job.cancelled", "job.retried"]);
  });

  it("a job that is no longer failed or pending says so", async () => {
    const done = await jobWith({ status: "done" });
    expect(await retryJobAction({ jobId: done })).toEqual({ ok: false, error: "Ese trabajo ya no está fallido." });
    expect(await cancelJobAction({ jobId: done })).toEqual({ ok: false, error: "Ese trabajo ya no está pendiente." });
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("Ajustes › Diagnóstico as %s [PER-03] [PER-04] [SEG-04]", (role) => {
  it("sees nothing and cannot retry or cancel", async () => {
    const failed = await jobWith({ status: "failed", lastError: "Fallo" });
    const pending = await jobWith({ status: "pending", lastError: "Fallo" });
    const person = await createUser(role);
    state.actor = person.actor;
    await expect(loadDiagnosticsView(person.actor)).rejects.toMatchObject({ status: 403 });
    expect(await retryJobAction({ jobId: failed })).toEqual(FORBIDDEN);
    expect(await cancelJobAction({ jobId: pending })).toEqual(FORBIDDEN);
    expect(await statusOf(failed)).toBe("failed");
    expect(await statusOf(pending)).toBe("pending");
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});
