// Inbox filters and quick tabs in the URL, in Spanish (docs/pantallas.md: «?estado=pendiente»), so a view can be
// shared and «Atrás» works ([BAN-02]). Pure: the list reads them in the browser; the server validates them again.
import { idSchema, labelSchema, MAX_LABELS } from "@/lib/validation";

export type InboxView = "all" | "pending" | "mine";
export type InboxStatus = "open" | "pending_human" | "resolved";
export type InboxMode = "ai" | "human" | "paused";
export type InboxAssignee = "me" | "unassigned";

export type InboxQuery = {
  view: InboxView;
  channelId: string | null;
  status: InboxStatus | null;
  assignee: InboxAssignee | null;
  mode: InboxMode | null;
  unread: boolean;
  labels: string[];
  search: string;
};

/** What the list asks the server for (src/data/conversations.ts › conversationFiltersSchema). */
export type ConversationFilterInput = {
  channelId?: string;
  status?: InboxStatus;
  assignee?: InboxAssignee;
  mode?: InboxMode;
  unread?: true;
  labels?: string[];
  search?: string;
};

export const EMPTY_QUERY: InboxQuery = {
  view: "all",
  channelId: null,
  status: null,
  assignee: null,
  mode: null,
  unread: false,
  labels: [],
  search: "",
};

const MAX_SEARCH = 100;

const PARAM = {
  view: "vista",
  channel: "canal",
  status: "estado",
  assignee: "asignado",
  mode: "modo",
  unread: "sinleer",
  label: "etiqueta",
  search: "q",
} as const;

const VIEW_VALUES: Record<Exclude<InboxView, "all">, string> = { pending: "pendientes", mine: "mias" };
const STATUS_VALUES: Record<InboxStatus, string> = { open: "abierta", pending_human: "pendiente", resolved: "resuelta" };
const ASSIGNEE_VALUES: Record<InboxAssignee, string> = { me: "yo", unassigned: "nadie" };
const MODE_VALUES: Record<InboxMode, string> = { ai: "ia", human: "persona", paused: "pausa" };

function fromParam<K extends string>(values: Record<K, string>, value: string | null): K | null {
  const entry = Object.entries(values).find(([, text]) => text === value);
  return entry ? (entry[0] as K) : null;
}

type ReadableParams = { get(name: string): string | null; getAll(name: string): string[] };

export function parseInboxQuery(params: ReadableParams): InboxQuery {
  const channel = params.get(PARAM.channel);
  const labels: string[] = [];
  for (const raw of params.getAll(PARAM.label)) {
    const label = labelSchema.safeParse(raw);
    if (label.success && !labels.includes(label.data) && labels.length < MAX_LABELS) labels.push(label.data);
  }
  return {
    view: fromParam(VIEW_VALUES, params.get(PARAM.view)) ?? "all",
    channelId: channel && idSchema.safeParse(channel).success ? channel : null,
    status: fromParam(STATUS_VALUES, params.get(PARAM.status)),
    assignee: fromParam(ASSIGNEE_VALUES, params.get(PARAM.assignee)),
    mode: fromParam(MODE_VALUES, params.get(PARAM.mode)),
    unread: params.get(PARAM.unread) === "1",
    labels,
    search: (params.get(PARAM.search) ?? "").trim().slice(0, MAX_SEARCH),
  };
}

/** The query string (without «?»), in a fixed order and without defaults. */
export function inboxQueryString(query: InboxQuery): string {
  const params = new URLSearchParams();
  if (query.view !== "all") params.set(PARAM.view, VIEW_VALUES[query.view]);
  if (query.channelId) params.set(PARAM.channel, query.channelId);
  if (query.status) params.set(PARAM.status, STATUS_VALUES[query.status]);
  if (query.assignee) params.set(PARAM.assignee, ASSIGNEE_VALUES[query.assignee]);
  if (query.mode) params.set(PARAM.mode, MODE_VALUES[query.mode]);
  if (query.unread) params.set(PARAM.unread, "1");
  for (const label of query.labels) params.append(PARAM.label, label);
  if (query.search) params.set(PARAM.search, query.search);
  return params.toString();
}

/** A path of the inbox that keeps the current filters. */
export function inboxHref(path: string, query: InboxQuery): string {
  const text = inboxQueryString(query);
  return text ? `${path}?${text}` : path;
}

/** Filters for the server; the quick tabs win over the same filter. */
export function toConversationFilters(query: InboxQuery): ConversationFilterInput {
  const filters: ConversationFilterInput = {};
  if (query.channelId) filters.channelId = query.channelId;
  const status = query.view === "pending" ? "pending_human" : query.status;
  if (status) filters.status = status;
  const assignee = query.view === "mine" ? "me" : query.assignee;
  if (assignee) filters.assignee = assignee;
  if (query.mode) filters.mode = query.mode;
  if (query.unread) filters.unread = true;
  if (query.labels.length > 0) filters.labels = query.labels;
  if (query.search) filters.search = query.search;
  return filters;
}

/** Filters set in the «Filtros» popover (the tab and the search box are not counted). */
export function activeFilterCount(query: InboxQuery): number {
  return [query.channelId, query.status, query.assignee, query.mode].filter(Boolean).length + (query.unread ? 1 : 0) + query.labels.length;
}

/** «Quitar filtros»: everything but the tab. */
export function clearFilters(query: InboxQuery): InboxQuery {
  return { ...EMPTY_QUERY, view: query.view };
}
