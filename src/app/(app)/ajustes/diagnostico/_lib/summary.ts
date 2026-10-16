// «Resumen» of Ajustes › Diagnóstico ([AJU-11]): whether everything works or what to look at, in plain words, from what
// the page has already read (nothing is asked again). Pure. Each line repeats a verdict the app already has: the
// database answers, its migrations, the last round of the background work, its failed jobs, the OpenRouter key, the
// system mail's server and a channel «con error». What has no rule of its own (how old an AI error must be to stop
// mattering) is told without a verdict.
import { DIAGNOSTICS_SECTIONS, type DiagnosticsSectionKey } from "./sections";

/** `info` is told without a verdict: it neither asks for a look nor reads «Correcto». */
export type SummaryStatus = "ok" | "warn" | "error" | "off" | "info";

/** One area and the section of the page where it is seen in full. */
export type SummaryRow = { section: DiagnosticsSectionKey; label: string; status: SummaryStatus; detail: string | null };

export type DiagnosticsSummary = {
  /** Areas that ask for a look: every one that is not «Correcto» nor told without a verdict. */
  attention: number;
  /** The worst of them, for the headline. */
  status: "ok" | "warn" | "error";
  headline: string;
  rows: SummaryRow[];
};

/** What the page knows when it opens; times come worded («hace 5 min», «ayer»). */
export type SummaryFacts = {
  /** `pendingMigrations` is null when they could not be read. */
  database: { ok: boolean; pendingMigrations: number | null };
  /** `lastRound` is null when no round has run yet; `stale`, when the last one is too old to trust it still runs. */
  queue: { lastRound: string | null; stale: boolean; failedJobs: number };
  /** `errors` and `lastError` are those of the page's list (the latest ones, of any age). */
  ai: { keyConfigured: boolean; errors: number; lastError: string | null };
  /** `outbox`: without a server, emails are kept in the local outbox (development and demo). */
  mail: { configured: boolean; outbox: boolean };
  /** Channels that talk to an outside service, the names of those «con error» and the last webhook of any of them. */
  channels: { count: number; withError: string[]; lastWebhook: string | null };
};

function databaseRow({ ok, pendingMigrations }: SummaryFacts["database"]): SummaryRow {
  const row = { section: "database", label: DIAGNOSTICS_SECTIONS.database.title } as const;
  if (!ok) return { ...row, status: "error", detail: "No responde. Hasta que responda no se puede comprobar nada más." };
  if (pendingMigrations === null) return { ...row, status: "off", detail: "No se ha podido comprobar si está al día." };
  if (pendingMigrations === 0) return { ...row, status: "ok", detail: null };
  const missing = pendingMigrations === 1 ? "falta 1 actualización" : `faltan ${pendingMigrations} actualizaciones`;
  return { ...row, status: "warn", detail: `Le ${missing} por aplicar (migraciones).` };
}

function queueRow({ lastRound, stale, failedJobs }: SummaryFacts["queue"]): SummaryRow {
  const stopped = lastRound === null || stale;
  const notes = [lastRound === null ? "Todavía no se ha ejecutado ninguna ronda." : `Última ronda: ${lastRound}.${stale ? " Puede que esté parado." : ""}`];
  if (failedJobs === 1) notes.push("Hay 1 trabajo fallido: puedes reintentarlo más abajo.");
  if (failedJobs > 1) notes.push(`Hay ${failedJobs} trabajos fallidos: puedes reintentarlos más abajo.`);
  return { section: "queue", label: DIAGNOSTICS_SECTIONS.queue.title, status: stopped || failedJobs > 0 ? "warn" : "ok", detail: notes.join(" ") };
}

function aiRow({ keyConfigured, errors, lastError }: SummaryFacts["ai"]): SummaryRow {
  const row = { section: "aiErrors", label: "IA" } as const;
  if (!keyConfigured) return { ...row, status: "warn", detail: "Falta la clave de OpenRouter: los agentes no responden. Ponla en Ajustes › IA." };
  if (errors === 0 || lastError === null) return { ...row, status: "ok", detail: null };
  // The list keeps its latest errors whatever their age: when the last one was is said, not judged.
  return { ...row, status: "info", detail: `Último error: ${lastError}.${errors > 1 ? ` Hay ${errors} en la lista.` : ""}` };
}

function mailRow({ configured, outbox }: SummaryFacts["mail"]): SummaryRow {
  const row = { section: "emails", label: "Correo del sistema" } as const;
  if (configured) return { ...row, status: "ok", detail: null };
  if (outbox) return { ...row, status: "ok", detail: "Sin servidor de correo: en local, los correos se guardan en la bandeja local." };
  return { ...row, status: "warn", detail: "Sin servidor de correo, las invitaciones y los avisos no salen. Configúralo en Ajustes › Correo del sistema." };
}

function channelsRow({ count, withError, lastWebhook }: SummaryFacts["channels"]): SummaryRow | null {
  if (count === 0) return null;
  if (withError.length > 0) {
    const names = withError.map((name) => `«${name}»`).join(", ");
    return { section: "connectionTests", label: "Canales", status: "error", detail: `Con error: ${names}. Su prueba está en «${DIAGNOSTICS_SECTIONS.connectionTests.title}».` };
  }
  return { section: "webhooks", label: "Canales", status: "ok", detail: lastWebhook ? `Último aviso recibido: ${lastWebhook}.` : null };
}

export function diagnosticsSummary(facts: SummaryFacts): DiagnosticsSummary {
  const database = databaseRow(facts.database);
  // Without a database nothing else could be read: the other lines would speak of made-up zeros.
  const rows = facts.database.ok
    ? [database, queueRow(facts.queue), aiRow(facts.ai), mailRow(facts.mail), channelsRow(facts.channels)].filter((row) => row !== null)
    : [database];
  const flagged = rows.filter((row) => row.status !== "ok" && row.status !== "info");
  const attention = flagged.length;
  return {
    attention,
    status: flagged.some((row) => row.status === "error") ? "error" : attention > 0 ? "warn" : "ok",
    headline: attention === 0 ? "Todo funciona" : attention === 1 ? "Hay 1 cosa que revisar" : `Hay ${attention} cosas que revisar`,
    rows,
  };
}
