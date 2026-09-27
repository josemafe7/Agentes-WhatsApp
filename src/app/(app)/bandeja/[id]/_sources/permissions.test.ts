import { describe, expect, it } from "vitest";
import { actorFor } from "@/test/factories";
import { canConvertToFaq, isConvertibleReply } from "./permissions";

const CHANNEL = crypto.randomUUID();
const OTHER_CHANNEL = crypto.randomUUID();

describe("«Convertir en FAQ»: who sees the action [PER-01] [CON-22]", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s can convert a reply", (role) => {
    expect(canConvertToFaq(actorFor(role), CHANNEL)).toBe(true);
  });

  it("an agent cannot, not even in their own channels; Solo lectura cannot either", () => {
    expect(canConvertToFaq(actorFor("agent", { channelIds: [CHANNEL] }), CHANNEL)).toBe(false);
    expect(canConvertToFaq(actorFor("agent"), OTHER_CHANNEL)).toBe(false);
    expect(canConvertToFaq(actorFor("viewer"), CHANNEL)).toBe(false);
  });
});

describe("«Convertir en FAQ»: which messages [CON-22]", () => {
  const reply = { senderType: "human", direction: "outbound", text: "Sí, un 10 % de lunes a jueves." } as const;

  it("a reply a person wrote to the customer", () => {
    expect(isConvertibleReply(reply)).toBe(true);
  });

  it("never an answer of the AI, a customer's message, a system line or a reply without text", () => {
    expect(isConvertibleReply({ ...reply, senderType: "ai" })).toBe(false);
    expect(isConvertibleReply({ ...reply, senderType: "contact", direction: "inbound" })).toBe(false);
    expect(isConvertibleReply({ ...reply, senderType: "system" })).toBe(false);
    expect(isConvertibleReply({ ...reply, text: null })).toBe(false);
    expect(isConvertibleReply({ ...reply, text: "   " })).toBe(false);
  });
});
