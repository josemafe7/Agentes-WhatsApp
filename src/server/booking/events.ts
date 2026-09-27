// A booking's history ([AGD-15]): who (a person, an AI agent or the app), what and when. Changes carry ids, times,
// statuses and field names, never free text such as notes.
import "server-only";
import type { Executor } from "@/db";
import { bookingEvents } from "@/db/schema";
import type { BookingActorType } from "@/lib/enums";

/** Who changes a booking: a person, an AI agent, or the app itself (reminders, notices). */
export type BookingActor = { type: "user"; userId: string; name: string } | { type: "ai"; agentId: string; name: string } | { type: "system" };

export type BookingEventAction =
  | "created"
  | "moved"
  | "updated"
  | "status_changed"
  | "cancelled"
  | "notice_sent"
  | "reminder_sent"
  | "reminder_failed";

function actorFields(actor: BookingActor): { actorType: BookingActorType; actorUserId: string | null; actorName: string | null } {
  if (actor.type === "user") return { actorType: "user", actorUserId: actor.userId, actorName: actor.name };
  if (actor.type === "ai") return { actorType: "ai", actorUserId: null, actorName: actor.name };
  return { actorType: "system", actorUserId: null, actorName: null };
}

/** One line of a booking's history. The agent's id goes with what an AI agent did. */
export async function recordBookingEvent(
  executor: Executor,
  bookingId: string,
  actor: BookingActor,
  action: BookingEventAction,
  changes: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await executor.insert(bookingEvents).values({
    bookingId,
    ...actorFields(actor),
    action,
    changes: actor.type === "ai" ? { ...changes, agentId: actor.agentId } : changes,
    createdAt: now,
    updatedAt: now,
  });
}
