import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ signedIn: false, calls: [] as (string | undefined)[] }));
vi.mock("@/server/session", () => ({
  requirePageActor: async (options: { next?: string } = {}) => {
    session.calls.push(options.next);
    if (!session.signedIn) throw new Error(`REDIRECT:/login?next=${encodeURIComponent(options.next ?? "")}`);
    return { userId: "u1", role: "viewer" };
  },
}));

import { requireWidgetDemoViewer } from "./access";

const CHAT = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

beforeEach(() => {
  session.signedIn = false;
  session.calls = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("who opens /widget-demo [WEB-12] [PER-09] [WEB-10]", () => {
  it("in the demo (local), anyone: nobody is asked to sign in", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(requireWidgetDemoViewer(CHAT)).resolves.toBeUndefined();
    expect(session.calls).toEqual([]);
  });

  it("in a real installation, only a signed-in person; anyone else goes to /login and comes back to the same chat", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    await expect(requireWidgetDemoViewer(CHAT)).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(`/widget-demo?canal=${CHAT}`)}`);
    await expect(requireWidgetDemoViewer(null)).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent("/widget-demo")}`);
    session.signedIn = true;
    await expect(requireWidgetDemoViewer(CHAT)).resolves.toBeUndefined();
  });

  it("without DEMO_MODE at all it is a real installation", async () => {
    vi.stubEnv("DEMO_MODE", "");
    await expect(requireWidgetDemoViewer(null)).rejects.toThrow("REDIRECT:");
  });
});
