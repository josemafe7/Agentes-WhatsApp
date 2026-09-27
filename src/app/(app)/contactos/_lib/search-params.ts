// Search and filters of Contactos live in the URL, in Spanish (docs/pantallas.md): ?buscar=ana&etiqueta=vip&canal=…&pagina=2.
// Values are passed through as they come; src/data/contacts.ts validates them with Zod ([SEG-05]).

export const CONTACTS_PATH = "/contactos";

export type ContactsQuery = { buscar?: string; etiqueta?: string; canal?: string };
export type ContactsFilter = { search?: string; label?: string; channelId?: string; page: number };
type SearchParams = Record<string, string | string[] | undefined>;

const QUERY_KEYS = ["buscar", "etiqueta", "canal"] as const;

function single(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

/** A page that is not a positive whole number shows the first one (the data layer clamps the last one). */
function pageNumber(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

export function contactsQueryFromSearchParams(params: SearchParams): { query: ContactsQuery; filter: ContactsFilter } {
  const query: ContactsQuery = {};
  for (const key of QUERY_KEYS) {
    const value = single(params[key]);
    if (value !== undefined) query[key] = value;
  }
  const filter: ContactsFilter = { page: pageNumber(single(params.pagina)) };
  if (query.buscar) filter.search = query.buscar;
  if (query.etiqueta) filter.label = query.etiqueta;
  if (query.canal) filter.channelId = query.canal;
  return { query, filter };
}

/** Link to a page of the list with the same search and filters. */
export function contactsHref(query: ContactsQuery, page = 1): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("pagina", String(page));
  const search = params.toString();
  return search ? `${CONTACTS_PATH}?${search}` : CONTACTS_PATH;
}

/** The contact's card. */
export function contactPath(contactId: string): string {
  return `${CONTACTS_PATH}/${contactId}`;
}
