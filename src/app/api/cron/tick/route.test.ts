import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => void scheduled.push(callback) }));

import { db } from "@/db";
import { jobs } from "@/db/schema";
import { getJobQueue } from "@/server/adapters/job-queue";
import { registerJobHandler } from "@/server/jobs";
import { TEST_ENV } from "@/test/env";
import { GET, maxDuration, POST, runtime } from "./route";

const request = (method: "GET" | "POST", authorization?: string) =>
  new Request("http://localhost:3000/api/cron/tick", { method, headers: authorization ? { authorization } : {} });

beforeEach(() => {
  scheduled.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/cron/tick [SEG-09] [MOT-15]", () => {
  it("runs on Node with an explicit maxDuration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });

  it.each([undefined, "Bearer mal", `bearer ${TEST_ENV.CRON_SECRET}`, TEST_ENV.CRON_SECRET, `Bearer ${TEST_ENV.CRON_SECRET}x`])(
    "answers 401 and does nothing with authorization %s",
    async (authorization) => {
      const response = await POST(request("POST", authorization));
      expect(response.status).toBe(401);
      expect(scheduled).toHaveLength(0);
    },
  );

  it("refuses everything when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("GET", "Bearer "))).status).toBe(401);
    expect(scheduled).toHaveLength(0);
  });

  it("with the secret (GET from Vercel Cron or POST from an external cron) answers 202 and runs tick() after", async () => {
    let ran = 0;
    registerJobHandler("test.cron", async () => {
      ran++;
    });
    const { id } = await getJobQueue().enqueue({ type: "test.cron" });
    for (const method of ["GET", "POST"] as const) {
      const response = await (method === "GET" ? GET : POST)(request(method, `Bearer ${TEST_ENV.CRON_SECRET}`));
      expect(response.status).toBe(202);
    }
    expect(scheduled).toHaveLength(2);
    await Promise.all(scheduled.map((run) => run()));
    expect(ran).toBe(1);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row.status).toBe("done");
  });
});
