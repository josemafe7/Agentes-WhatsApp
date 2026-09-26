import { describe, expect, it } from "vitest";
import { actorFor } from "@/test/factories";
import { isDemoMode, openRouterNotice } from "./banner-state";

describe("isDemoMode", () => {
  it("[ARR-05] the «Modo demo» banner shows when DEMO_MODE is exactly true", () => {
    expect(isDemoMode({ DEMO_MODE: "true" })).toBe(true);
  });

  it.each([undefined, "", "false", "1", "TRUE ", "yes"])("[ARR-18] DEMO_MODE=%s is not demo mode", (value) => {
    expect(isDemoMode({ DEMO_MODE: value })).toBe(false);
  });
});

describe("openRouterNotice", () => {
  it("[ARR-15] with a usable key there is no notice", () => {
    expect(openRouterNotice(actorFor("owner"), true)).toBeNull();
    expect(openRouterNotice(actorFor("viewer"), true)).toBeNull();
  });

  it.each(["owner", "admin"] as const)("[ARR-14] %s gets the notice with the button to Settings › IA", (role) => {
    expect(openRouterNotice(actorFor(role), false)).toBe("manage");
  });

  it.each(["supervisor", "agent", "viewer"] as const)(
    "[ARR-14] [PER-04] %s gets the softer notice without the link to the keys",
    (role) => {
      expect(openRouterNotice(actorFor(role), false)).toBe("ask");
    },
  );
});
