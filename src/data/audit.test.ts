import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { REDACTED } from "@/server/redact";
import { actorFor } from "@/test/factories";
import { writeAudit } from "./audit";

describe("writeAudit [AJU-10] [SEG-10]", () => {
  it("records people, the AI and the system, without secrets", async () => {
    const admin = actorFor("admin", { name: "Marta" });
    await writeAudit({
      actor: admin,
      action: "channel.connected",
      targetType: "channel",
      targetId: "c1",
      metadata: { accessToken: "EAAB-secret", appSecret: "shh", step: 2, note: "Bearer abcdef123" },
    });
    await writeAudit({ actor: "ai", action: "tool.used", metadata: { tool: "crear_cita" } });
    await writeAudit({ actor: "system", action: "retention.cleanup", metadata: { deleted: 3 } });
    const rows = await db.select().from(auditLog).orderBy(auditLog.createdAt);
    expect(rows.map((r) => [r.actorType, r.actorName, r.action])).toEqual([
      ["user", "Marta", "channel.connected"],
      ["ai", null, "tool.used"],
      ["system", null, "retention.cleanup"],
    ]);
    expect(rows[0].actorUserId).toBe(admin.userId);
    expect(rows[0].metadata).toEqual({ accessToken: REDACTED, appSecret: REDACTED, step: 2, note: `Bearer ${REDACTED}` });
  });
});
