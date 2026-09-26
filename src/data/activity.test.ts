import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { AuthError, ValidationError } from "@/server/errors";
import { actorFor, createBusiness } from "@/test/factories";
import { ACTIVITY_PAGE_SIZE, listActivity, listActivityActions } from "./activity";
import { writeAudit } from "./audit";

const owner = actorFor("owner", { name: "Marta" });
const admin = actorFor("admin", { name: "Luis" });
const denied: Role[] = ["supervisor", "agent", "viewer"];

async function entryAt(createdAt: Date, values: Partial<typeof auditLog.$inferInsert> = {}) {
  await db.insert(auditLog).values({ actorType: "system", action: "retention.cleanup", createdAt, updatedAt: createdAt, ...values });
}

beforeEach(async () => {
  await createBusiness({ timezone: "Europe/Madrid" });
  await db.delete(auditLog);
});

describe("listActivity [AJU-10] [SEG-10]", () => {
  it("owner and admin see what people, the AI and the system did, newest first", async () => {
    await entryAt(new Date("2026-09-20T10:00:00Z"), { actorType: "system", action: "retention.cleanup" });
    await entryAt(new Date("2026-09-21T10:00:00Z"), { actorType: "ai", action: "tool.used", targetType: "conversation" });
    await writeAudit({ actor: owner, action: "user.invited", targetType: "invitation", targetId: "inv-1", metadata: { role: "agent" } });

    for (const actor of [owner, admin]) {
      const page = await listActivity(actor, {});
      expect(page.total).toBe(3);
      expect(page.entries.map((e) => e.action)).toEqual(["user.invited", "tool.used", "retention.cleanup"]);
      expect(page.entries[0]).toMatchObject({
        actorType: "user",
        actorName: "Marta",
        targetType: "invitation",
        targetId: "inv-1",
        details: { role: "agent" },
      });
    }
  });

  it.each(denied)("%s cannot read it [PER-03] [PER-04]", async (role) => {
    await writeAudit({ actor: owner, action: "user.invited" });
    await expect(listActivity(actorFor(role), {})).rejects.toBeInstanceOf(AuthError);
    await expect(listActivityActions(actorFor(role))).rejects.toBeInstanceOf(AuthError);
  });

  it("filters by who (person, AI, system) and by action", async () => {
    await writeAudit({ actor: owner, action: "user.invited" });
    await writeAudit({ actor: owner, action: "user.removed" });
    await writeAudit({ actor: "ai", action: "tool.used" });
    await writeAudit({ actor: "system", action: "retention.cleanup" });

    expect((await listActivity(owner, { actorType: "ai" })).entries.map((e) => e.action)).toEqual(["tool.used"]);
    expect((await listActivity(owner, { actorType: "user" })).total).toBe(2);
    expect((await listActivity(owner, { action: "user.removed" })).entries.map((e) => e.action)).toEqual(["user.removed"]);
    expect(await listActivityActions(owner)).toEqual(["retention.cleanup", "tool.used", "user.invited", "user.removed"]);
  });

  it("filters by day in the business time zone, both ends included", async () => {
    // 23:30 on 25 September and 00:30 on 26 September in Madrid (UTC+2 in summer).
    await entryAt(new Date("2026-09-25T21:30:00Z"), { action: "a.late_25" });
    await entryAt(new Date("2026-09-25T22:30:00Z"), { action: "b.early_26" });
    await entryAt(new Date("2026-09-27T21:59:00Z"), { action: "c.late_27" });
    await entryAt(new Date("2026-09-27T22:00:00Z"), { action: "d.early_28" });

    const from26 = await listActivity(owner, { from: "2026-09-26" });
    expect(from26.entries.map((e) => e.action).sort()).toEqual(["b.early_26", "c.late_27", "d.early_28"]);
    const until25 = await listActivity(owner, { to: "2026-09-25" });
    expect(until25.entries.map((e) => e.action)).toEqual(["a.late_25"]);
    const range = await listActivity(owner, { from: "2026-09-26", to: "2026-09-27" });
    expect(range.entries.map((e) => e.action).sort()).toEqual(["b.early_26", "c.late_27"]);
  });

  it("paginates on the server, 25 per page", async () => {
    const base = Date.UTC(2026, 8, 1);
    for (let i = 0; i < ACTIVITY_PAGE_SIZE + 3; i++) await entryAt(new Date(base + i * 60_000), { action: `x.n${i}` });
    const first = await listActivity(owner, {});
    expect(first).toMatchObject({ total: 28, page: 1, pageCount: 2, pageSize: 25 });
    expect(first.entries).toHaveLength(25);
    expect(first.entries[0].action).toBe("x.n27");
    const second = await listActivity(owner, { page: 2 });
    expect(second.entries.map((e) => e.action)).toEqual(["x.n2", "x.n1", "x.n0"]);
    // A page past the end shows the last one instead of an empty table.
    expect((await listActivity(owner, { page: 9 })).page).toBe(2);
  });

  it("never returns secrets, even if one reached the stored details [SEG-02]", async () => {
    await entryAt(new Date(), {
      action: "settings.integrations_updated",
      metadata: { token: "EAAB-meta-token-value", note: "Authorization: Bearer sk-or-v1-abcdefghijklmnopqrst", fields: ["openrouterKey"] },
    });
    const [entry] = (await listActivity(owner, {})).entries;
    const json = JSON.stringify(entry);
    expect(json).not.toContain("EAAB-meta-token-value");
    expect(json).not.toContain("sk-or-v1-abcdefghijklmnopqrst");
    expect(entry.details.fields).toEqual(["openrouterKey"]);
  });

  it("rejects invalid filters and saves nothing [SEG-05]", async () => {
    await expect(listActivity(owner, { actorType: "robot" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listActivity(owner, { from: "26/09/2026" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listActivity(owner, { from: "2026-02-30" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listActivity(owner, { from: "2026-09-27", to: "2026-09-26" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listActivity(owner, { action: "DROP TABLE audit_log;" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listActivity(owner, { page: 0 })).rejects.toBeInstanceOf(ValidationError);
  });
});
