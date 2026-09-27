// The contact's next bookings next to the conversation, with «Nueva cita» linked to it ([BAN-15], [CTO-02]): whoever
// sees the conversation sees them; only who may book gets the button ([PER-01], [PER-03]).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking, type BookingActor } from "@/server/booking";
import { at, createHairdresser, NOW } from "@/server/booking/test-helpers";
import { createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { loadConversationBookings, PANEL_BOOKINGS } from "./load";

let channelId: string;
let agent: TestUser;
let viewer: TestUser;
let supervisor: TestUser;
let system: BookingActor;
let hair: Awaited<ReturnType<typeof createHairdresser>>;
let ana: string;
let conversationId: string;

beforeAll(async () => {
  channelId = (await createChannel({ name: "Chat de la web" })).id;
  agent = await createUser("agent", { channelIds: [channelId] });
  viewer = await createUser("viewer");
  supervisor = await createUser("supervisor");
  system = { type: "user", userId: supervisor.userId, name: supervisor.name };
});

beforeEach(async () => {
  hair = await createHairdresser();
  ana = (await createContactWithIdentity("webchat", { name: "Ana" })).contact.id;
  conversationId = (await createConversation(channelId, ana)).id;
});

const book = (start: string) => createBooking({ serviceId: hair.cut.id, resourceId: "any", start: at(start), contactId: ana, source: "human", actor: system, now: NOW });

describe("next bookings in the conversation's side panel [BAN-15] [CTO-02]", () => {
  it("shows the next ones, soonest first, and how many more there are; «Nueva cita» for an Agent of the channel", async () => {
    await book("2026-09-28T10:00");
    const upcoming = [await book("2026-09-29T10:00"), await book("2026-09-30T10:00"), await book("2026-10-01T10:00"), await book("2026-10-02T10:00")];
    const panel = await loadConversationBookings(agent.actor, { conversationId, channelId, contactId: ana }, at("2026-09-28T12:00"));
    expect(PANEL_BOOKINGS).toBe(3);
    expect(panel).toMatchObject({ conversationId, contactId: ana, canBook: true, moreUpcoming: 1, words: { newBooking: "Nueva cita" } });
    expect(panel?.upcoming.map((item) => item.id)).toEqual(upcoming.slice(0, 3).map((item) => item.id));
  });

  it("Solo lectura sees them without «Nueva cita» [PER-03]", async () => {
    await book("2026-09-29T10:00");
    expect(await loadConversationBookings(viewer.actor, { conversationId, channelId, contactId: ana }, NOW)).toMatchObject({ canBook: false, upcoming: [expect.any(Object)] });
  });

  it("a conversation without a contact has nothing to show", async () => {
    expect(await loadConversationBookings(supervisor.actor, { conversationId, channelId, contactId: null }, NOW)).toBeNull();
  });

  it("an Agent of another channel gets nothing [PER-02]", async () => {
    const other = await createUser("agent", { channelIds: [(await createChannel({ name: "Otro chat" })).id] });
    await book("2026-09-29T10:00");
    expect(await loadConversationBookings(other.actor, { conversationId, channelId, contactId: ana }, NOW)).toBeNull();
  });
});
