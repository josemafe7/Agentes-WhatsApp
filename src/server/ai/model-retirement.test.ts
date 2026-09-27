// Models in use that retire or leave OpenRouter's list ([MOD-06]) and the notice «Modelo de IA que se retira»
// ([AJU-08]): after each download of the list, and every 12 hours in the background with the business's key ([MOD-01]),
// the people of Ajustes › Notificaciones (owner and admins by default) hear once about each model in use.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agents, appKv, businessSettings, integrationSettings, jobs, notifications } from "@/db/schema";
import { createOpenRouterClient } from "@/lib/openrouter/client";
import { LibsqlJobQueue } from "@/server/adapters/job-queue";
import { tick } from "@/server/jobs";
import { NOTIFICATIONS_DELIVER_JOB } from "@/server/notifications/notify";
import { createAgentRow, createBusiness, createUser, type TestUser } from "@/test/factories";
import { FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { ensureModelCatalogRefreshJob, getModelCatalog, MODEL_CATALOG_REFRESH_JOB, MODEL_CATALOG_TTL_MS } from "./models";

const RETIRING = "deepseek/deepseek-v3.2";
/** An entry of GET /models as the fake gives it. */
type CatalogEntry = Record<string, unknown>;

let owner: TestUser;
let admin: TestUser;
let supervisor: TestUser;

/** The sample list with `id` retiring from `date` instead. */
const withExpiration = (id: string, date: string): CatalogEntry[] => sampleCatalog().map((entry) => (entry.id === id ? { ...entry, expiration_date: date } : entry));
/** The sample list without `id`. */
const without = (id: string): CatalogEntry[] => sampleCatalog().filter((entry) => entry.id !== id);

/** «Actualizar lista» with the business key, answered by a fake OpenRouter with `entries`. */
async function download(entries: CatalogEntry[] = sampleCatalog()) {
  const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: entries }) }));
  await getModelCatalog({ fetchImpl: fake.fetch, refresh: true });
  return fake;
}

const noticesOf = (user: TestUser) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, user.userId), eq(notifications.event, "model_deprecated")));

const refreshJobs = () => db.select().from(jobs).where(eq(jobs.type, MODEL_CATALOG_REFRESH_JOB));

beforeAll(async () => {
  await createBusiness();
  owner = await createUser("owner");
  admin = await createUser("admin");
  supervisor = await createUser("supervisor");
});

beforeEach(async () => {
  await db.delete(notifications);
  await db.delete(jobs);
  await db.delete(appKv);
  await db.delete(agents);
  await db.update(integrationSettings).set({ defaultModels: {} });
  await db.update(businessSettings).set({ notificationSettings: {} });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a model in use that announces its retirement [MOD-06] [AJU-08]", () => {
  it("after a download, owner and admins hear it once, with the date, who uses it and where to change it", async () => {
    const agent = await createAgentRow({ name: "Recepción", model: RETIRING, fallbackModel: "google/gemini-3.1-flash-lite" });
    await download();

    const [notice, ...rest] = await noticesOf(owner);
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({ event: "model_deprecated", link: `/agentes/${agent.id}/modelo`, readAt: null });
    expect(notice.title).toContain("DeepSeek: V3.2");
    expect(notice.body).toContain("se retira a partir del 28 sep 2026");
    expect(notice.body).toContain("«Recepción»");
    expect(await noticesOf(admin)).toHaveLength(1);
    // Ajustes › Notificaciones: owner and admins by default, not the rest of the team.
    expect(await noticesOf(supervisor)).toHaveLength(0);
    // Each person's channels (Mi cuenta): by default also by email, never by push.
    const deliveries = (await db.select().from(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB))).map((job) => job.payload);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner.userId, event: "model_deprecated", email: true, push: false }),
        expect.objectContaining({ userId: admin.userId, event: "model_deprecated", email: true, push: false }),
      ]),
    );
  });

  it("warns once per model and state: the same list says nothing again; a new date, or the model leaving the list, is news", async () => {
    await createAgentRow({ model: RETIRING });
    await download();
    await download();
    expect(await noticesOf(owner)).toHaveLength(1);

    await download(withExpiration(RETIRING, "2026-10-15"));
    expect((await noticesOf(owner)).map((notice) => notice.body)).toEqual(
      expect.arrayContaining([expect.stringContaining("28 sep 2026"), expect.stringContaining("15 oct 2026")]),
    );

    await download(without(RETIRING));
    await download(without(RETIRING));
    const notices = await noticesOf(owner);
    expect(notices).toHaveLength(3);
    expect(notices.filter((notice) => notice.title.includes("ya no está en OpenRouter") && notice.title.includes(RETIRING))).toHaveLength(1);
  });

  it("the defaults of Ajustes › IA count too, and a retiring model that nobody uses never warns", async () => {
    await db.update(integrationSettings).set({ defaultModels: { chat: "vieja/modelo-retirado" } });
    // The sample list has a retiring model (DeepSeek) that nobody uses here.
    await download();
    const notices = await noticesOf(owner);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ link: "/ajustes/ia" });
    expect(notices[0].title).toContain("vieja/modelo-retirado");
    expect(notices[0].body).toContain("Ajustes › IA");
  });

  it("an agent with the model as fallback counts, and several agents with it go in the same notice", async () => {
    await createAgentRow({ name: "Recepción", model: "openai/gpt-5.6-luna", fallbackModel: RETIRING });
    await createAgentRow({ name: "Correo", model: RETIRING, fallbackModel: "google/gemini-3.1-flash-lite" });
    await download();
    const [notice, ...rest] = await noticesOf(owner);
    expect(rest).toEqual([]);
    expect(notice.body).toContain("«Recepción»");
    expect(notice.body).toContain("«Correo»");
    expect(notice.link).toBe("/agentes");
  });

  it("Ajustes › Notificaciones decides: turned off, nobody hears it", async () => {
    await db.update(businessSettings).set({ notificationSettings: { model_deprecated: { enabled: false, roles: ["owner", "admin"] } } });
    await createAgentRow({ model: RETIRING });
    await download();
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("a failed download warns nothing: an unreachable OpenRouter is not a missing model", async () => {
    await createAgentRow({ model: "openai/gpt-5.6-luna" });
    await download();
    const down = fakeFetch(() => jsonResponse({ error: { code: 503, message: "down" } }, 503));
    await getModelCatalog({ fetchImpl: down.fetch, refresh: true });
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("two downloads at the same moment still warn once", async () => {
    await createAgentRow({ model: RETIRING });
    await Promise.all([download(), download()]);
    expect(await noticesOf(owner)).toHaveLength(1);
    expect(await noticesOf(admin)).toHaveLength(1);
  });
});

describe("the list is downloaded again every 12 hours, only with a key [MOD-01] [MOD-06]", () => {
  it("a download with the business key leaves one recurring job, 12 hours later", async () => {
    await download();
    await download();
    const [job, ...rest] = await refreshJobs();
    expect(rest).toEqual([]);
    expect(job).toMatchObject({ status: "pending", intervalMs: MODEL_CATALOG_TTL_MS, dedupeKey: `recurring:${MODEL_CATALOG_REFRESH_JOB}` });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + MODEL_CATALOG_TTL_MS - 60_000);
  });

  it("a key only being tried (not saved) leaves no job", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
    const typed = createOpenRouterClient({ apiKey: "sk-or-v1-escrita-sin-guardar", baseUrl: FAKE_BASE_URL, fetchImpl: fake.fetch });
    await getModelCatalog({ client: typed, refresh: true });
    expect(fake.calls).toHaveLength(1);
    expect(await refreshJobs()).toEqual([]);
  });

  it("the queue runs it: the list is asked for again and a change is told to the team; without a key it asks nothing", async () => {
    await createAgentRow({ model: RETIRING });
    await download();
    expect(await noticesOf(owner)).toHaveLength(1);
    // Only the refresh job is due in these rounds (the notices' emails are not the point here).
    await db.delete(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB));
    const [job] = await refreshJobs();
    const inTwelveHours = () => new Date(job.runAt.getTime() + 1_000);

    const later = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: withExpiration(RETIRING, "2026-10-15") }) }));
    vi.stubGlobal("fetch", later.fetch);
    vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
    const summary = await tick({ budgetMs: 30_000, maxJobs: 1, queue: new LibsqlJobQueue({ now: inTwelveHours }) });
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(later.calls.map((call) => call.path)).toEqual(["/models/user"]);
    expect(later.calls[0].headers.get("authorization")).toBe(`Bearer ${FAKE_OPENROUTER_KEY}`);
    expect((await noticesOf(owner)).map((notice) => notice.body)).toEqual(expect.arrayContaining([expect.stringContaining("15 oct 2026")]));
    const [again] = await refreshJobs();
    expect(again).toMatchObject({ id: job.id, status: "pending" });

    // The key is removed: the job keeps its turn but asks OpenRouter nothing ([MOD-08]).
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await db.delete(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB));
    const quiet = fakeFetch(() => jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", quiet.fetch);
    const next = await tick({ budgetMs: 30_000, maxJobs: 1, queue: new LibsqlJobQueue({ now: () => new Date(again.runAt.getTime() + 1_000) }) });
    expect(next).toMatchObject({ claimed: 1, completed: 1 });
    expect(quiet.calls).toHaveLength(0);
  });

  it("asking for it again changes nothing", async () => {
    await ensureModelCatalogRefreshJob();
    await ensureModelCatalogRefreshJob();
    expect(await refreshJobs()).toHaveLength(1);
  });
});
