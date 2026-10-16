// «Resumen» of Ajustes › Diagnóstico ([AJU-11]): one verdict from what the page already read. The rules are those the
// sections below already show (a database that answers, pending migrations, a round that is too old, failed jobs, no
// OpenRouter key, no mail server, a channel «con error»); the errors of the AI are told, never judged.
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { getJobQueue } from "@/server/adapters/job-queue";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { SummarySection } from "../_components/summary";
import { DIAGNOSTICS_SECTIONS } from "./sections";
import { diagnosticsSummary, type SummaryFacts } from "./summary";
import { loadDiagnosticsView } from "./view";

const ALL_GOOD: SummaryFacts = {
  database: { ok: true, pendingMigrations: 0 },
  queue: { lastRound: "hace 1 min", stale: false, failedJobs: 0 },
  ai: { keyConfigured: true, errors: 0, lastError: null },
  mail: { configured: true, outbox: false },
  channels: { count: 2, withError: [], lastWebhook: "hace 3 min" },
};

const rowOf = (facts: SummaryFacts, label: string) => diagnosticsSummary(facts).rows.find((row) => row.label === label);

describe("Diagnóstico › Resumen: the verdict [AJU-11]", () => {
  it("says everything works when nothing asks for a look, with one line for each area", () => {
    const summary = diagnosticsSummary(ALL_GOOD);
    expect(summary).toMatchObject({ headline: "Todo funciona", status: "ok", attention: 0 });
    expect(summary.rows).toEqual([
      { section: "database", label: "Base de datos", status: "ok", detail: null },
      { section: "queue", label: "Trabajo en segundo plano", status: "ok", detail: "Última ronda: hace 1 min." },
      { section: "aiErrors", label: "IA", status: "ok", detail: null },
      { section: "emails", label: "Correo del sistema", status: "ok", detail: null },
      { section: "webhooks", label: "Canales", status: "ok", detail: "Último aviso recibido: hace 3 min." },
    ]);
  });

  it("counts what asks for a look, and the worst of it sets the tone", () => {
    const one = diagnosticsSummary({ ...ALL_GOOD, queue: { lastRound: "hace 1 min", stale: false, failedJobs: 1 } });
    expect(one).toMatchObject({ headline: "Hay 1 cosa que revisar", status: "warn", attention: 1 });

    const three = diagnosticsSummary({
      ...ALL_GOOD,
      database: { ok: true, pendingMigrations: 2 },
      ai: { keyConfigured: false, errors: 0, lastError: null },
      channels: { count: 2, withError: ["WhatsApp Recepción"], lastWebhook: null },
    });
    expect(three).toMatchObject({ headline: "Hay 3 cosas que revisar", status: "error", attention: 3 });
  });

  it("without a database only that is said: nothing else could be read", () => {
    const summary = diagnosticsSummary({ ...ALL_GOOD, database: { ok: false, pendingMigrations: null }, queue: { lastRound: null, stale: true, failedJobs: 0 } });
    expect(summary).toMatchObject({ headline: "Hay 1 cosa que revisar", status: "error" });
    expect(summary.rows).toEqual([
      { section: "database", label: "Base de datos", status: "error", detail: "No responde. Hasta que responda no se puede comprobar nada más." },
    ]);
  });
});

describe("Diagnóstico › Resumen: each area [AJU-11]", () => {
  it("the database: migrations to apply, or that could not be read", () => {
    expect(rowOf({ ...ALL_GOOD, database: { ok: true, pendingMigrations: 1 } }, "Base de datos")).toMatchObject({
      status: "warn",
      detail: "Le falta 1 actualización por aplicar (migraciones).",
    });
    expect(rowOf({ ...ALL_GOOD, database: { ok: true, pendingMigrations: 3 } }, "Base de datos")?.detail).toBe("Le faltan 3 actualizaciones por aplicar (migraciones).");
    expect(rowOf({ ...ALL_GOOD, database: { ok: true, pendingMigrations: null } }, "Base de datos")).toMatchObject({
      status: "off",
      detail: "No se ha podido comprobar si está al día.",
    });
    expect(diagnosticsSummary({ ...ALL_GOOD, database: { ok: true, pendingMigrations: null } }).attention).toBe(1);
  });

  it("the background work: no round yet, an old one, or failed jobs", () => {
    const label = "Trabajo en segundo plano";
    expect(rowOf({ ...ALL_GOOD, queue: { lastRound: null, stale: true, failedJobs: 0 } }, label)).toMatchObject({
      status: "warn",
      detail: "Todavía no se ha ejecutado ninguna ronda.",
    });
    expect(rowOf({ ...ALL_GOOD, queue: { lastRound: "ayer", stale: true, failedJobs: 0 } }, label)).toMatchObject({
      status: "warn",
      detail: "Última ronda: ayer. Puede que esté parado.",
    });
    expect(rowOf({ ...ALL_GOOD, queue: { lastRound: "ahora", stale: false, failedJobs: 1 } }, label)).toMatchObject({
      status: "warn",
      detail: "Última ronda: ahora. Hay 1 trabajo fallido: puedes reintentarlo más abajo.",
    });
    expect(rowOf({ ...ALL_GOOD, queue: { lastRound: "ahora", stale: false, failedJobs: 4 } }, label)?.detail).toBe(
      "Última ronda: ahora. Hay 4 trabajos fallidos: puedes reintentarlos más abajo.",
    );
  });

  it("the AI: a missing key asks for a look; its errors are told with their date and judge nothing", () => {
    expect(rowOf({ ...ALL_GOOD, ai: { keyConfigured: false, errors: 2, lastError: "ayer" } }, "IA")).toMatchObject({
      status: "warn",
      detail: "Falta la clave de OpenRouter: los agentes no responden. Ponla en Ajustes › IA.",
    });
    const withErrors = diagnosticsSummary({ ...ALL_GOOD, ai: { keyConfigured: true, errors: 5, lastError: "12 sep" } });
    expect(withErrors.rows.find((row) => row.label === "IA")).toMatchObject({ status: "info", detail: "Último error: 12 sep. Hay 5 en la lista." });
    // The list keeps old errors: they must not leave the summary asking for a look for ever.
    expect(withErrors).toMatchObject({ headline: "Todo funciona", attention: 0 });
    expect(rowOf({ ...ALL_GOOD, ai: { keyConfigured: true, errors: 1, lastError: "hace 5 min" } }, "IA")?.detail).toBe("Último error: hace 5 min.");
  });

  it("the system mail: without a server it only works where the local outbox keeps the emails", () => {
    expect(rowOf({ ...ALL_GOOD, mail: { configured: false, outbox: true } }, "Correo del sistema")).toMatchObject({
      status: "ok",
      detail: "Sin servidor de correo: en local, los correos se guardan en la bandeja local.",
    });
    expect(rowOf({ ...ALL_GOOD, mail: { configured: false, outbox: false } }, "Correo del sistema")).toMatchObject({
      status: "warn",
      detail: "Sin servidor de correo, las invitaciones y los avisos no salen. Configúralo en Ajustes › Correo del sistema.",
    });
  });

  it("the channels: one «con error» sends to its test; without channels there is no line", () => {
    expect(rowOf({ ...ALL_GOOD, channels: { count: 3, withError: ["WhatsApp Recepción", "Buzón"], lastWebhook: "hace 3 min" } }, "Canales")).toEqual({
      section: "connectionTests",
      label: "Canales",
      status: "error",
      detail: "Con error: «WhatsApp Recepción», «Buzón». Su prueba está en «Pruebas de conexión».",
    });
    expect(rowOf({ ...ALL_GOOD, channels: { count: 1, withError: [], lastWebhook: null } }, "Canales")).toMatchObject({ status: "ok", detail: null });
    expect(rowOf({ ...ALL_GOOD, channels: { count: 0, withError: [], lastWebhook: null } }, "Canales")).toBeUndefined();
  });
});

describe("Diagnóstico › Resumen: on the page [AJU-11]", () => {
  const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

  it("shows the verdict and a line for each area that leads to its section; the other sections are linked too", () => {
    const html = renderToStaticMarkup(createElement(SummarySection, { summary: diagnosticsSummary(ALL_GOOD) }));
    expect(text(html)).toContain("Resumen");
    expect(text(html)).toContain("Todo funciona");
    for (const key of ["database", "queue", "aiErrors", "emails", "webhooks"] as const) {
      expect(html).toContain(`href="#${DIAGNOSTICS_SECTIONS[key].id}"`);
    }
    // Every section of the page is one click away, each linked once.
    for (const section of Object.values(DIAGNOSTICS_SECTIONS)) {
      expect(html.split(`href="#${section.id}"`), section.title).toHaveLength(2);
    }
    const others = html.slice(html.indexOf("<nav"));
    expect(text(others)).toBe("También en esta página:Correos ignoradosTiempo realSimulador de canales");
  });

  it("a line without a verdict has no status word, and one with an error says so", () => {
    const html = renderToStaticMarkup(
      createElement(SummarySection, {
        summary: diagnosticsSummary({
          ...ALL_GOOD,
          ai: { keyConfigured: true, errors: 2, lastError: "ayer" },
          channels: { count: 1, withError: ["WhatsApp Recepción"], lastWebhook: null },
        }),
      }),
    );
    const lines = [...html.matchAll(/<li>.*?<\/li>/g)].map((match) => text(match[0]));
    expect(lines).toEqual([
      "Base de datosCorrecto",
      "Trabajo en segundo planoCorrectoÚltima ronda: hace 1 min.",
      "IAÚltimo error: ayer. Hay 2 en la lista.",
      "Correo del sistemaCorrecto",
      "CanalesErrorCon error: «WhatsApp Recepción». Su prueba está en «Pruebas de conexión».",
    ]);
    expect(text(html)).toContain("Hay 1 cosa que revisar");
    // The line of the channels now leads to the tests, so the webhooks section is linked at the end.
    expect(text(html.slice(html.indexOf("<nav")))).toContain("Último aviso por canal");
  });
});

describe("Diagnóstico › Resumen: from what the page reads [AJU-11]", () => {
  let admin: TestUser;

  beforeAll(async () => {
    await createBusiness();
    admin = await createUser("admin");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a failed job, a channel «con error» and no key are three things to look at", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const { id } = await getJobQueue().enqueue({ type: "email.sync" });
    await db.update(jobs).set({ status: "failed", lastError: "No se pudo conectar con el buzón." }).where(eq(jobs.id, id));
    await createChannel({ type: "whatsapp", name: "WhatsApp caído", status: "error" });
    await createChannel({ type: "telegram", name: "Bot de avisos", status: "connected" });

    const { summary, queue } = await loadDiagnosticsView(admin.actor);
    expect(summary).toMatchObject({ headline: "Hay 3 cosas que revisar", status: "error", attention: 3 });
    expect(summary.rows.map((row) => [row.label, row.status])).toEqual([
      ["Base de datos", "ok"],
      ["Trabajo en segundo plano", "warn"],
      ["IA", "warn"],
      ["Correo del sistema", "ok"],
      ["Canales", "error"],
    ]);
    expect(summary.rows[1].detail).toBe("Todavía no se ha ejecutado ninguna ronda. Hay 1 trabajo fallido: puedes reintentarlo más abajo.");
    expect(summary.rows[4].detail).toBe("Con error: «WhatsApp caído». Su prueba está en «Pruebas de conexión».");
    // The same numbers the section below shows.
    expect(queue.counts.failed).toBe(1);
  });
});
