import { describe, expect, it } from "vitest";
import { nextMessageStatus } from "./status";

describe("delivery statuses only move forward [WA-38]", () => {
  it("advances queued < sent < delivered < read < played", () => {
    expect(nextMessageStatus("queued", "sent")).toBe("sent");
    expect(nextMessageStatus("sent", "delivered")).toBe("delivered");
    expect(nextMessageStatus("delivered", "read")).toBe("read");
    expect(nextMessageStatus("read", "played")).toBe("played");
    // «delivered» may never arrive.
    expect(nextMessageStatus("sent", "read")).toBe("read");
  });

  it("an older status arriving late changes nothing", () => {
    expect(nextMessageStatus("read", "delivered")).toBeNull();
    expect(nextMessageStatus("read", "read")).toBeNull();
    expect(nextMessageStatus("played", "sent")).toBeNull();
  });

  it("«failed» only replaces «queued» or «sent»", () => {
    expect(nextMessageStatus("queued", "failed")).toBe("failed");
    expect(nextMessageStatus("sent", "failed")).toBe("failed");
    expect(nextMessageStatus("delivered", "failed")).toBeNull();
    expect(nextMessageStatus("failed", "delivered")).toBeNull();
  });

  it("inbound messages and drafts have no delivery status", () => {
    expect(nextMessageStatus("received", "read")).toBeNull();
    expect(nextMessageStatus("draft", "sent")).toBeNull();
  });
});
