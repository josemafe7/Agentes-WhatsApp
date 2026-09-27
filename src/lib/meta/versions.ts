// Graph API versions (docs/integracion-whatsapp.md §1): every call carries the channel's version ([WA-49]); v26.0 is
// the default of a new channel. The dates are Meta's table, kept here as a revisable constant (never computed).
// Pure: the channel panel uses it for the «Versión» traffic light.

export const DEFAULT_GRAPH_API_VERSION = "v26.0";

/** Published and available-until dates (UTC calendar days) of the versions still served. null = no end date yet. */
export const GRAPH_API_VERSIONS: readonly { version: string; releasedAt: string; availableUntil: string | null }[] = [
  { version: "v26.0", releasedAt: "2026-07-29", availableUntil: null },
  { version: "v25.0", releasedAt: "2026-02-18", availableUntil: "2028-07-29" },
  { version: "v24.0", releasedAt: "2025-10-08", availableUntil: "2028-02-18" },
  { version: "v23.0", releasedAt: "2025-05-29", availableUntil: "2027-10-08" },
  { version: "v22.0", releasedAt: "2025-01-21", availableUntil: "2027-05-20" },
  { version: "v21.0", releasedAt: "2024-10-02", availableUntil: "2027-01-21" },
];

const VERSION_PATTERN = /^v\d{1,3}\.\d{1,2}$/;
/** Amber when fewer than this many days are left ([WA-26], «Versión»). */
export const VERSION_WARNING_DAYS = 183;
const DAY_MS = 24 * 60 * 60 * 1000;

/** «v26.0»-shaped: nothing else ever reaches a Graph URL. */
export function isValidGraphVersion(value: string): boolean {
  return VERSION_PATTERN.test(value);
}

export type GraphVersionStatus = {
  status: "ok" | "warn" | "error";
  /** End of availability, or null when Meta has not set one (or the version is not in the table). */
  availableUntil: Date | null;
  /** Spanish explanation for the panel. */
  detail: string;
};

/** Traffic light of a channel's Graph API version: green without end date or with more than 6 months left. */
export function graphVersionStatus(version: string | null | undefined, now: Date = new Date()): GraphVersionStatus {
  const current = version || DEFAULT_GRAPH_API_VERSION;
  const known = GRAPH_API_VERSIONS.find((entry) => entry.version === current);
  if (!known) {
    return { status: "warn", availableUntil: null, detail: `La versión ${current} no está en la tabla de versiones conocidas. Revisa que exista.` };
  }
  if (!known.availableUntil) return { status: "ok", availableUntil: null, detail: `Versión ${current}, sin fecha de fin.` };
  const until = new Date(`${known.availableUntil}T00:00:00Z`);
  const daysLeft = Math.floor((until.getTime() - now.getTime()) / DAY_MS);
  if (daysLeft < 0) return { status: "error", availableUntil: until, detail: `La versión ${current} ya no está disponible. Cámbiala por ${DEFAULT_GRAPH_API_VERSION}.` };
  if (daysLeft < VERSION_WARNING_DAYS) {
    return { status: "warn", availableUntil: until, detail: `A la versión ${current} le quedan ${daysLeft} días. Cámbiala por ${DEFAULT_GRAPH_API_VERSION}.` };
  }
  return { status: "ok", availableUntil: until, detail: `Versión ${current}, disponible hasta el ${known.availableUntil}.` };
}
