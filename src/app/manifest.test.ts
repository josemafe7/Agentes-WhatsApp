import { describe, expect, it, vi } from "vitest";

// connection() only exists inside a Next.js request; here every call is "a request".
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => undefined }));

import { createBusiness } from "@/test/factories";
import manifest from "./manifest";

describe("/manifest.webmanifest [PWA-01]", () => {
  it("is read from the business settings on every request, never frozen at build time", async () => {
    await createBusiness({ name: "Clínica Lumen", color: "#0f766e" });
    expect(await manifest()).toMatchObject({ name: "Clínica Lumen", theme_color: "#0f766e", start_url: "/bandeja", display: "standalone" });

    await createBusiness({ name: "Clínica Lumen Norte", color: "#1e2a4a" });
    expect(await manifest()).toMatchObject({ name: "Clínica Lumen Norte", theme_color: "#1e2a4a" });
  });
});
