// `pnpm seed` ([ARR-06], [ARR-07], [ARR-09], [ARR-10], [ARR-18], [ARR-19], [ARR-20]) against this file's own test
// database. Each test starts from an empty database.
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  account,
  businessHours,
  businessSettings,
  closures,
  DEFAULT_RETENTION,
  resources,
  resourceSchedules,
  serviceResources,
  services,
  user,
  userRoles,
} from "@/db/schema";
import { ROLES } from "@/lib/enums";
import { getSectorPreset, SECTOR_PRESETS } from "@/lib/sectors";
import { auth } from "@/server/auth";
import { getInstallState } from "@/server/demo/install-state";
import { createBusiness, createUser } from "@/test/factories";
import { DEMO_PASSWORD, DEMO_USERS } from "../../seed";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase, tableCounts } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true", NODE_ENV: "development" };
const NOW = new Date("2026-09-26T10:00:00Z");

function seed(argv: string[] = [], env: Record<string, string | undefined> = DEMO_ENV, now = NOW) {
  const out = captureOutput();
  return runSeedCommand(argv, { out, env, now }).then((code) => ({ code, out }));
}

/** Signs in with Better Auth's server API, as the sign-in action does. */
async function signIn(email: string, password: string, ip: string) {
  return auth.api.signInEmail({ body: { email, password }, headers: new Headers({ "x-forwarded-for": ip }), asResponse: true });
}

beforeEach(async () => {
  await emptyDatabase();
});

describe("pnpm seed", () => {
  it("[ARR-09] [ARR-01] loads one demo user per role who can sign in with the known password", async () => {
    const { code, out } = await seed();
    expect(code).toBe(0);
    const rows = await db
      .select({ email: user.email, role: userRoles.role, isDemo: userRoles.isDemo })
      .from(user)
      .innerJoin(userRoles, eq(userRoles.userId, user.id));
    expect(rows.map((r) => r.role).sort()).toEqual([...ROLES].sort());
    expect(rows.map((r) => r.email).sort()).toEqual(DEMO_USERS.map((u) => u.email).sort());
    expect(DEMO_PASSWORD).toBe("demo1234");
    for (const [index, demoUser] of DEMO_USERS.entries()) {
      const response = await signIn(demoUser.email, DEMO_PASSWORD, `10.9.0.${index + 1}`);
      expect(response.status, demoUser.email).toBe(200);
    }
    // The command shows the same users table as the README.
    for (const demoUser of DEMO_USERS) expect(out.text()).toContain(demoUser.email);
  });

  it("[ARR-20] demo users are marked as demo (so they can be listed and deleted) and each has its own salt", async () => {
    await seed();
    const roles = await db.select({ isDemo: userRoles.isDemo }).from(userRoles);
    expect(roles.every((r) => r.isDemo)).toBe(true);
    const hashes = await db.select({ password: account.password }).from(account);
    expect(new Set(hashes.map((h) => h.password)).size).toBe(DEMO_USERS.length);
    expect(hashes.some((h) => h.password === DEMO_PASSWORD)).toBe(false);
  });

  it("[ARR-06] the default demo is a hair salon with hours, services and named professionals", async () => {
    await seed();
    const [settings] = await db.select().from(businessSettings);
    expect(settings).toMatchObject({ name: "Peluquería Aurora", sector: "peluqueria", timezone: "Europe/Madrid" });
    expect(settings.setupCompletedAt).not.toBeNull();
    expect(settings.aiDisclosureText).toContain("inteligencia artificial");
    expect(settings.privacyText).toBeTruthy();
    expect(settings.termsText).toBeTruthy();
    expect(settings.dataDeletionText).toBeTruthy();
    expect(settings.retention).toEqual(DEFAULT_RETENTION);
    expect(settings.terminology).toEqual(getSectorPreset("peluqueria").terminology);

    const preset = getSectorPreset("peluqueria");
    const serviceRows = await db.select().from(services).orderBy(asc(services.sortOrder));
    expect(serviceRows.map((s) => s.name)).toEqual(preset.services.map((s) => s.name));
    expect(serviceRows.every((s) => s.price !== null && s.price > 0)).toBe(true);
    const resourceRows = await db.select().from(resources).orderBy(asc(resources.sortOrder));
    expect(resourceRows.map((r) => r.name)).toEqual(["Lucía", "Andrés", "Marta"]);
    expect(await db.select().from(resourceSchedules)).toHaveLength(preset.resources.flatMap((r) => r.schedule).length);
    expect(await db.select().from(serviceResources)).toHaveLength(preset.services.flatMap((s) => s.resourceKeys).length);
    expect(await db.select().from(businessHours)).toHaveLength(preset.businessHours.length);
  });

  it("[ARR-07] closures are placed relative to the day the demo is loaded, in the business time zone", async () => {
    await seed([], DEMO_ENV, NOW);
    const first = await db.select().from(closures).orderBy(asc(closures.startDate));
    expect(first.map((c) => [c.startDate, c.endDate])).toEqual([
      ["2026-10-05", "2026-10-05"],
      ["2026-11-05", "2026-11-06"],
    ]);
    // 23:30 UTC is already the next day in Madrid.
    await emptyDatabase();
    await seed([], DEMO_ENV, new Date("2027-03-01T23:30:00Z"));
    const second = await db.select().from(closures).orderBy(asc(closures.startDate));
    expect(second[0].startDate).toBe("2027-03-11");
  });

  it("[ARR-10] --sector loads that sector's demo instead of the hair salon", async () => {
    const { code } = await seed(["--sector=clinica-dental"]);
    expect(code).toBe(0);
    const preset = SECTOR_PRESETS["clinica-dental"];
    const [settings] = await db.select().from(businessSettings);
    expect(settings.sector).toBe("clinica-dental");
    expect(settings.terminology).toMatchObject({ customer: "paciente" });
    const names = (await db.select({ name: services.name }).from(services)).map((s) => s.name).sort();
    expect(names).toEqual(preset.services.map((s) => s.name).sort());
    expect(await getInstallState()).toMatchObject({ kind: "demo", sector: "clinica-dental" });
  });

  it.each(Object.keys(SECTOR_PRESETS))("[ARR-10] the demo of %s loads", async (sector) => {
    const { code, out } = await seed([`--sector=${sector}`]);
    expect(out.errors).toEqual([]);
    expect(code).toBe(0);
  });

  it("[ARR-10] an unknown sector fails, lists the valid ones and does not touch the database", async () => {
    const before = await tableCounts();
    const { code, out } = await seed(["--sector=veterinaria"]);
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("veterinaria");
    for (const slug of Object.keys(SECTOR_PRESETS)) expect(out.errors.join("\n")).toContain(slug);
    expect(await tableCounts()).toEqual(before);
  });

  it("an unknown option is refused without touching the database", async () => {
    const before = await tableCounts();
    const { code, out } = await seed(["--sectr=taller"]);
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("--sector");
    expect(await tableCounts()).toEqual(before);
  });

  it("[ARR-18] refuses without DEMO_MODE=true or in production, unless --force-demo", async () => {
    const before = await tableCounts();
    for (const env of [{}, { DEMO_MODE: "false" }, { DEMO_MODE: "true", NODE_ENV: "production" }]) {
      const { code, out } = await seed([], env);
      expect(code).toBe(1);
      expect(out.errors.join("\n")).toContain("--force-demo");
    }
    expect(await tableCounts()).toEqual(before);
    const forced = await seed(["--force-demo"], {});
    expect(forced.code).toBe(0);
  });

  it("[ARR-19] refuses on a real business installation and touches nothing, whatever the options", async () => {
    await createBusiness({ name: "Barbería Real", sector: "peluqueria" });
    await createUser("owner", { email: "duena@barberia.example" });
    const before = await tableCounts();
    for (const argv of [[], ["--sector=taller"], ["--force-demo"], ["--sector=taller", "--force-demo"]]) {
      const { code, out } = await seed(argv);
      expect(code).toBe(1);
      expect(out.errors.join("\n")).toContain("negocio real");
    }
    expect(await tableCounts()).toEqual(before);
    const [settings] = await db.select().from(businessSettings);
    expect(settings.name).toBe("Barbería Real");
  });

  it("[ARR-10] a demo already loaded (the hair salon of the first pnpm dev) is replaced by the sector asked for, without duplicates", async () => {
    await seed();
    const replaced = await seed(["--sector=restaurante"]);
    expect(replaced.code).toBe(0);
    expect(replaced.out.text()).toContain("Restaurante La Encina");
    const [settings] = await db.select().from(businessSettings);
    expect(settings).toMatchObject({ sector: "restaurante", agendaMode: "capacity", name: "Restaurante La Encina" });
    expect(await db.select().from(user)).toHaveLength(DEMO_USERS.length);
    const names = (await db.select({ name: services.name }).from(services)).map((s) => s.name).sort();
    expect(names).toEqual(SECTOR_PRESETS.restaurante.services.map((s) => s.name).sort());
    expect(await getInstallState()).toMatchObject({ kind: "demo", sector: "restaurante" });
  });
});
