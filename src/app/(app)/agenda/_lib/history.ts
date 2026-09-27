// A booking's history in plain Spanish ([AGD-15]): who (a person, the AI with its agent, the customer or the app),
// what and when, in the business time zone. The rows come from booking_events (ids, times, statuses and field
// names, never free text); anything unknown still reads as «Cambio registrado».
import type { BookingActorType } from "@/lib/enums";
import { formatDateTime } from "@/lib/format";
import { type AgendaWords, STATUS_LABELS } from "./labels";

export type HistoryItem = {
  id: string;
  action: string;
  actorType: BookingActorType;
  actorName: string | null;
  changes: Record<string, unknown>;
  createdAt: Date;
};

export type HistoryLine = { id: string; when: string; who: string; what: string };

type Context = { timezone: string; resourceNames: ReadonlyMap<string, string>; words: AgendaWords };

type Change<T> = { from: T; to: T };

function isChange<T>(value: unknown, guard: (item: unknown) => item is T): value is Change<T> {
  return typeof value === "object" && value !== null && "from" in value && "to" in value && guard(value.from) && guard(value.to);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";

const statusText = (status: string) => (status in STATUS_LABELS ? STATUS_LABELS[status as keyof typeof STATUS_LABELS].toLowerCase() : status);

function when(iso: string, timezone: string): string {
  return formatDateTime(iso, timezone, { pattern: "EEE d MMM, HH:mm" });
}

function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function fieldNames(fields: unknown, words: AgendaWords): string[] {
  if (!Array.isArray(fields)) return [];
  const names = new Set<string>();
  for (const field of fields) {
    if (field === "notes") names.add("las notas");
    else if (field === "contactId" || field === "contactName") names.add(`el ${words.customer}`);
  }
  return [...names];
}

/** The changes of a move or an update, in the order a person reads them. */
function changeParts(changes: Record<string, unknown>, context: Context): string[] {
  const parts: string[] = [];
  if (isChange(changes.startsAt, isString)) parts.push(`Movida: ${when(changes.startsAt.from, context.timezone)} → ${when(changes.startsAt.to, context.timezone)}`);
  if (isChange(changes.resourceId, isString)) {
    const name = (id: string) => context.resourceNames.get(id) ?? "otro";
    parts.push(`${context.words.Resource}: ${name(changes.resourceId.from)} → ${name(changes.resourceId.to)}`);
  }
  if (isChange(changes.endsAt, isString)) parts.push(`Ahora termina el ${when(changes.endsAt.to, context.timezone)}`);
  if (isChange(changes.people, isNumber)) parts.push(`Personas: ${changes.people.from} → ${changes.people.to}`);
  const fields = fieldNames(changes.fields, context.words);
  if (fields.length) parts.push(`Cambiad${fields.length > 1 || fields[0] === "las notas" ? "as" : "o"} ${joinSpanish(fields)}`);
  return parts;
}

const NOTICE_KINDS: Record<string, string> = { confirmed: "confirmación enviada", moved: "cambio de hora enviado", cancelled: "cancelación enviada" };

function describe(item: HistoryItem, context: Context): string {
  const { changes } = item;
  switch (item.action) {
    case "created":
      return isString(changes.status) ? `Creada · ${statusText(changes.status)}` : "Creada";
    case "moved":
    case "updated": {
      const parts = changeParts(changes, context);
      return parts.length ? parts.join(" · ") : "Cambio registrado";
    }
    case "status_changed":
      return isChange(changes.status, isString) ? `Estado: ${statusText(changes.status.from)} → ${statusText(changes.status.to)}` : "Estado cambiado";
    case "cancelled":
      return "Cancelada";
    case "notice_sent":
      return isString(changes.kind) && NOTICE_KINDS[changes.kind] ? `Aviso al ${context.words.customer}: ${NOTICE_KINDS[changes.kind]}` : `Aviso enviado al ${context.words.customer}`;
    case "reminder_sent":
      return "Recordatorio enviado";
    case "reminder_failed":
      return "No se ha podido enviar el recordatorio";
    default:
      return "Cambio registrado";
  }
}

function who(item: HistoryItem, words: AgendaWords): string {
  switch (item.actorType) {
    case "user":
      return item.actorName ?? "Una persona del equipo";
    case "ai":
      return item.actorName ? `IA · ${item.actorName}` : "IA";
    case "contact":
      return `El ${words.customer}`;
    default:
      return "La app";
  }
}

export function historyLines(history: readonly HistoryItem[], context: Context): HistoryLine[] {
  return history.map((item) => ({
    id: item.id,
    when: formatDateTime(item.createdAt, context.timezone),
    who: who(item, context.words),
    what: describe(item, context),
  }));
}
