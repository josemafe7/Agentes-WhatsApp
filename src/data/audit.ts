// Activity log ([AJU-10], [SEG-10]): who (person, AI or system) did what on which record. Append-only and
// without secrets or personal data: metadata is secret-stripped here, and callers pass ids, not contents.
import "server-only";
import { db, type Executor } from "@/db";
import { auditLog } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { stripSecrets } from "@/server/redact";

export type AuditEntry = {
  actor: Actor | "system" | "ai";
  /** Dotted name, e.g. user.invited, user.role_changed, settings.business_updated, channel.connected. */
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(entry: AuditEntry, executor: Executor = db): Promise<void> {
  const person = typeof entry.actor === "object" ? entry.actor : null;
  await executor.insert(auditLog).values({
    actorType: person ? "user" : entry.actor === "ai" ? "ai" : "system",
    actorUserId: person?.userId ?? null,
    actorName: person?.name ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: stripSecrets(entry.metadata ?? {}) as Record<string, unknown>,
  });
}
