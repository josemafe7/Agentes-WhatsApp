// [USU-15] The messages, notes and bookings of a deleted user keep their name as author: deleting someone from Ajustes ›
// Usuarios never deletes nor anonymises what they did (their messages are checked in src/data/users.test.ts).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookingEvents, bookings, internalNotes, user } from "@/db/schema";
import { changeBookingStatus, createBooking } from "@/server/booking";
import { at, createHairdresser, NOW } from "@/server/booking/test-helpers";
import { createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { addNote, listNotes } from "./notes";
import { removeUser } from "./users";

let owner: TestUser;
let member: TestUser;

beforeEach(async () => {
  owner = await createUser("owner");
  member = await createUser("supervisor", { name: "Susana Gil" });
});

describe("a deleted user's notes and bookings keep their name [USU-15]", () => {
  it("the note they wrote, the booking they made and its history still say who did it", async () => {
    const hair = await createHairdresser();
    const channel = await createChannel({ name: "Web" });
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(channel.id, contact.id);
    await addNote(member.actor, { conversationId: conversation.id, text: "Prefiere las mañanas" });
    const booking = await createBooking({
      serviceId: hair.cut.id,
      resourceId: hair.laura.id,
      start: at("2026-09-28T10:00"),
      contactId: contact.id,
      contactName: "Cliente",
      source: "human",
      actor: { type: "user", userId: member.userId, name: member.name },
      now: NOW,
    });
    await changeBookingStatus({ bookingId: booking.id, status: "cancelled", actor: { type: "user", userId: member.userId, name: member.name }, now: NOW });

    await removeUser(owner.actor, { userId: member.userId });
    expect(await db.select().from(user).where(eq(user.id, member.userId))).toEqual([]);

    const [note] = await db.select().from(internalNotes).where(eq(internalNotes.conversationId, conversation.id));
    expect(note).toMatchObject({ authorName: "Susana Gil", text: "Prefiere las mañanas" });
    expect(note.authorUserId).toBeNull();
    expect((await listNotes(owner.actor, conversation.id)).map((item) => item.authorName)).toEqual(["Susana Gil"]);

    const [kept] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(kept).toMatchObject({ createdByName: "Susana Gil", createdByUserId: null, status: "cancelled" });
    const history = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, booking.id));
    expect(history.length).toBeGreaterThanOrEqual(2);
    for (const event of history) expect(event).toMatchObject({ actorName: "Susana Gil", actorUserId: null });
  });
});
