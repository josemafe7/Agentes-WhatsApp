import { describe, expect, it } from "vitest";
import { actorFor } from "@/test/factories";
import { businessInitials, homeDestination } from "./home-destination";

describe("homeDestination", () => {
  it("[ASI-01] an empty installation (no users, setup never finished) goes to the setup wizard", () => {
    expect(homeDestination({ setupCompleted: false, actor: null })).toBe("/setup");
  });

  it("[ASI-11] a setup left half-way goes back to the wizard, also with a session", () => {
    expect(homeDestination({ setupCompleted: false, actor: actorFor("owner") })).toBe("/setup");
  });

  it("[USU-02] without a session a finished installation goes to the login page", () => {
    expect(homeDestination({ setupCompleted: true, actor: null })).toBe("/login");
  });

  it.each(["owner", "admin", "supervisor", "agent", "viewer"] as const)(
    "[USU-01] %s with a session lands in the inbox",
    (role) => {
      expect(homeDestination({ setupCompleted: true, actor: actorFor(role) })).toBe("/bandeja");
    },
  );
});

describe("businessInitials", () => {
  it("takes the first letter of the first two words, in capitals", () => {
    expect(businessInitials("Peluquería Ana")).toBe("PA");
    expect(businessInitials("clínica dental sonrisa")).toBe("CD");
    expect(businessInitials("Óptica")).toBe("Ó");
  });

  it("ignores extra spaces and symbols", () => {
    expect(businessInitials("  Taller   & Motos ")).toBe("TM");
  });

  it("falls back to the product initials when there is no name yet", () => {
    expect(businessInitials("")).toBe("DA");
    expect(businessInitials("   ")).toBe("DA");
  });
});
