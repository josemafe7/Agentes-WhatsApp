// The person's own notices ([PWA-06], [PWA-08]): list with unread count and «marcar como leído». Nobody reads or
// changes another person's notices; an Agent never sees one of a channel that is no longer theirs.
import "server-only";
import { and, count, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { channelFilter, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { parseInput } from "@/server/errors";
import { assertCan } from "./guard";

const DEFAULT_LIMIT = 30;

export type NotificationItem = {
  id: string;
  event: string;
  title: string;
  body: string | null;
  link: string | null;
  channelId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

function ownConditions(actor: Actor): SQL[] {
  const scoped = channelFilter(actor);
  const channelCondition = scoped ? or(isNull(notifications.channelId), inArray(notifications.channelId, [...scoped])) : undefined;
  return [eq(notifications.userId, actor.userId), ...(channelCondition ? [channelCondition] : [])];
}

export const listNotificationsSchema = z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(DEFAULT_LIMIT) }).strict();

export async function listMyNotifications(actor: Actor, input: unknown = {}): Promise<NotificationItem[]> {
  assertCan(actor, PERMISSIONS.account.self);
  const data = parseInput(listNotificationsSchema, input);
  return db
    .select({
      id: notifications.id,
      event: notifications.event,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      channelId: notifications.channelId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(...ownConditions(actor), ...(data.unreadOnly ? [isNull(notifications.readAt)] : [])))
    .orderBy(desc(notifications.createdAt))
    .limit(data.limit);
}

/** The bell's counter ([PWA-06]). */
export async function countMyUnreadNotifications(actor: Actor): Promise<number> {
  assertCan(actor, PERMISSIONS.account.self);
  const [row] = await db.select({ n: count() }).from(notifications).where(and(...ownConditions(actor), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Marks one of the person's own notices as read; someone else's id changes nothing. */
export async function markNotificationRead(actor: Actor, notificationId: string): Promise<boolean> {
  assertCan(actor, PERMISSIONS.account.self);
  const id = idSchema.safeParse(notificationId);
  if (!id.success) return false;
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.id, id.data), eq(notifications.userId, actor.userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function markAllNotificationsRead(actor: Actor): Promise<number> {
  assertCan(actor, PERMISSIONS.account.self);
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}
