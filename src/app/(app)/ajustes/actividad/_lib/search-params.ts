// Filters of the activity log live in the URL, in Spanish (docs/pantallas.md): ?quien=ia&accion=…&desde=…&hasta=…&pagina=2.
// Values are passed through as they come; src/data/activity.ts validates them with Zod ([SEG-05]).

export const ACTIVITY_PATH = "/ajustes/actividad";

/** URL value → audit actor type. */
const ACTOR_TYPES: Record<string, string> = { persona: "user", ia: "ai", sistema: "system" };

export type ActivityQuery = { quien?: string; accion?: string; desde?: string; hasta?: string };
type SearchParams = Record<string, string | string[] | undefined>;

const QUERY_KEYS = ["quien", "accion", "desde", "hasta"] as const;

function single(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = Array.isArray(value) ? value.join(",") : value;
  return text.trim() === "" ? undefined : text.trim();
}

export function activityQueryFromSearchParams(params: SearchParams) {
  const query: ActivityQuery = {};
  for (const key of QUERY_KEYS) {
    const value = single(params[key]);
    if (value !== undefined) query[key] = value;
  }
  const page = single(params.pagina);
  const filter: { actorType?: string; action?: string; from?: string; to?: string; page: number } = {
    page: page === undefined ? 1 : Number(page),
  };
  if (query.quien) filter.actorType = ACTOR_TYPES[query.quien] ?? query.quien;
  if (query.accion) filter.action = query.accion;
  if (query.desde) filter.from = query.desde;
  if (query.hasta) filter.to = query.hasta;
  return { query, filter };
}

/** Link to a page of the log with the same filters. */
export function activityHref(query: ActivityQuery, page: number): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("pagina", String(page));
  const search = params.toString();
  return search ? `${ACTIVITY_PATH}?${search}` : ACTIVITY_PATH;
}
