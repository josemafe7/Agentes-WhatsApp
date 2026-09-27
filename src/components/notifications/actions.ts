"use server";
// Server Actions of the notifications bell ([PWA-06], [PWA-08]): the person's own notices, the unread count and
// «marcar como leído». Thin: session here, then src/data/notifications.ts, which only ever touches the person's rows.
import { z } from "zod";
import { countMyUnreadNotifications, listMyNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from "@/data/notifications";
import { getBusinessProfile } from "@/data/settings";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

/** Notices shown in the bell's list. */
const BELL_LIMIT = 20;

export type NotificationsView = { items: NotificationItem[]; unread: number; timezone: string };

export async function loadNotificationsAction(): Promise<ActionResult<NotificationsView>> {
  try {
    const actor = await requirePermission(PERMISSIONS.account.self);
    const [items, unread, profile] = await Promise.all([
      listMyNotifications(actor, { limit: BELL_LIMIT }),
      countMyUnreadNotifications(actor),
      getBusinessProfile(actor),
    ]);
    return ok({ items, unread, timezone: profile.timezone });
  } catch (error) {
    return toActionFailure(error);
  }
}

const markReadSchema = z.object({ notificationId: idSchema }).strict();

/** Someone else's notice changes nothing (and says nothing about it). */
export async function markNotificationReadAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.account.self);
    const parsed = markReadSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado el aviso.");
    await markNotificationRead(actor, parsed.data.notificationId);
    return ok();
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.account.self);
    await markAllNotificationsRead(actor);
    return ok();
  } catch (error) {
    return toActionFailure(error);
  }
}
