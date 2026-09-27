// Notices to the team ([TRA-05], [PWA-06]–[PWA-08], [AJU-08]): in-app rows at once, and email (system mail) and push
// through a job, each as the person chose in Mi cuenta. Recipients are the roles of Ajustes › Notificaciones (or the
// people given, e.g. the agent's «a quién avisar»), always filtered by permission: an Agent only hears about their
// channels. Titles say what happened and with whom, never the customer's text ([PWA-04]); the details of a notice
// about a conversation (a hand-off's reason) stay inside the app: its email and push carry only the title and link.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEmailBrand } from "@/data/business";
import {
  NOTIFICATION_EVENT_DEFINITIONS,
  NOTIFICATION_EVENTS,
  resolveNotificationPreferences,
  resolveNotificationSettings,
  type NotificationEvent,
} from "@/data/notification-settings";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { notifications, user, userRoles } from "@/db/schema";
import { can, PERMISSIONS } from "@/lib/permissions";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { appUrl } from "@/server/app-url";
import { notificationEmail } from "@/server/email-templates";
import { sendSystemEmail, type MailerOptions } from "@/server/mailer";
import { publishNotificationEvent } from "@/server/realtime/events";
import { listActiveTeam, type TeamMember } from "@/server/team";
import { deliverPush } from "./push";

export const NOTIFICATIONS_DELIVER_JOB = "notifications.deliver";
const MAX_TITLE = 200;
const MAX_BODY = 500;

export type NotifyInput = {
  event: NotificationEvent;
  /** «Traspaso: Ana». */
  title: string;
  body?: string | null;
  /** In-app path to open (never an external URL). */
  link?: string | null;
  /** The channel it relates to: only people who can see it are told ([PWA-08]). */
  channelId?: string | null;
  /** These people instead of the roles of Ajustes (still filtered by permission). */
  userIds?: readonly string[];
  /** Whoever caused it does not need a notice. */
  excludeUserIds?: readonly string[];
  queue?: JobQueue;
};

export type NotifyResult = { recipients: string[]; notificationIds: string[] };

export const deliverJobPayload = z.object({
  userId: z.string().min(1),
  event: z.enum(NOTIFICATION_EVENTS),
  title: z.string().min(1).max(MAX_TITLE),
  body: z.string().max(MAX_BODY).nullable(),
  link: z.string().max(500).nullable(),
  email: z.boolean(),
  push: z.boolean(),
});
export type DeliverJobPayload = z.infer<typeof deliverJobPayload>;

/**
 * Notices about a conversation, whose body may retell what the customer wrote (the reason the AI gave for a hand-off):
 * outside the app — a locked phone, a mail server — they say only what happened and with whom ([PWA-04]).
 */
const BODY_ONLY_IN_APP: ReadonlySet<NotificationEvent> = new Set(["handoff", "new_conversation", "conversation_assigned"]);

function isAllowed(member: TeamMember, channelId: string | null | undefined): boolean {
  return channelId ? can(member, PERMISSIONS.inbox.view, { channelId }) : true;
}

/** Only in-app paths: a notice never links outside the app. */
function safeLink(link: string | null | undefined): string | null {
  return link && link.startsWith("/") && !link.startsWith("//") ? link.slice(0, 500) : null;
}

/** Who gets a notice of `input.event`, already filtered by permission and channel. */
export async function resolveRecipients(input: Pick<NotifyInput, "event" | "channelId" | "userIds" | "excludeUserIds">): Promise<TeamMember[]> {
  const settings = resolveNotificationSettings((await loadBusinessSettings()).notificationSettings)[input.event];
  if (!settings.enabled) return [];
  const { audience } = NOTIFICATION_EVENT_DEFINITIONS[input.event];
  const team = await listActiveTeam();
  const explicit = input.userIds && input.userIds.length > 0 ? new Set(input.userIds) : null;
  const excluded = new Set(input.excludeUserIds ?? []);
  return team.filter((member) => {
    if (excluded.has(member.userId)) return false;
    const chosen = explicit ? explicit.has(member.userId) : audience === "roles" && settings.roles.includes(member.role);
    return chosen && isAllowed(member, input.channelId);
  });
}

/** Tells the right people. In-app rows are written now; email and push go through the queue. */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const recipients = await resolveRecipients(input);
  const title = input.title.slice(0, MAX_TITLE);
  const body = input.body?.slice(0, MAX_BODY) ?? null;
  const link = safeLink(input.link);
  const queue = input.queue ?? getJobQueue();
  const notificationIds: string[] = [];
  for (const member of recipients) {
    const preference = resolveNotificationPreferences(member.notificationPreferences)[input.event];
    if (preference.inApp) {
      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(notifications)
          .values({ userId: member.userId, event: input.event, title, body, link, channelId: input.channelId ?? null })
          .returning({ id: notifications.id });
        await publishNotificationEvent({ notificationId: row.id, userId: member.userId }, { executor: tx });
        return row.id;
      });
      notificationIds.push(id);
    }
    if (preference.email || preference.push) {
      const outsideBody = BODY_ONLY_IN_APP.has(input.event) ? null : body;
      const payload: DeliverJobPayload = { userId: member.userId, event: input.event, title, body: outsideBody, link, email: preference.email, push: preference.push };
      await queue.enqueue({ type: NOTIFICATIONS_DELIVER_JOB, payload, maxAttempts: 3 });
    }
  }
  return { recipients: recipients.map((member) => member.userId), notificationIds };
}

/** Job: sends one person's email and push for a notice. Without system mail the email is simply skipped. */
export async function deliverNotification(payload: DeliverJobPayload, options: { mailer?: MailerOptions } = {}): Promise<void> {
  const [person] = await db
    .select({ email: user.email, name: user.name, disabledAt: userRoles.disabledAt })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.id, payload.userId));
  if (!person || person.disabledAt) return;
  const absoluteLink = payload.link ? appUrl(payload.link) : null;
  if (payload.email) {
    const content = notificationEmail({ brand: await getEmailBrand(), name: person.name, title: payload.title, body: payload.body, link: absoluteLink });
    const result = await sendSystemEmail({ kind: "notification", to: person.email, ...content }, options.mailer);
    // Not configured: nothing to retry (Diagnóstico lists it); a failed send is retried by the queue.
    if (!result.ok && result.reason === "send_failed") throw new Error(result.message);
  }
  if (payload.push) await deliverPush(payload.userId, { title: payload.title, body: payload.body, link: payload.link });
}
