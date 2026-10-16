import { Bot, Cog, User } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditActorType } from "@/lib/enums";
import { cn } from "@/lib/utils";
import type { DetailItem } from "../_lib/labels";

export type ActivityRow = {
  id: string;
  /** «12 oct 2026» and «10:42», in the business time zone. */
  day: string;
  time: string;
  actorType: AuditActorType;
  who: string;
  action: string;
  actionCode: string;
  target: string | null;
  details: DetailItem[];
};

const ACTOR_ICONS = { user: User, ai: Bot, system: Cog } as const;
/** Cells of the table: text wraps inside its column, so the table never grows wider than the page. */
const CELL = "align-top whitespace-normal wrap-anywhere";

function Who({ row }: { row: ActivityRow }) {
  const Icon = ACTOR_ICONS[row.actorType];
  return (
    <span className="inline-flex items-start gap-1.5">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      {row.who}
    </span>
  );
}

/** One after another under what was done (table) or one per line (card). An identifier shows its start; hovering, all of it. */
function Details({ items, inline = false }: { items: DetailItem[]; inline?: boolean }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("text-xs text-muted-foreground", !inline && "space-y-0.5")}>
      {items.map((item, index) => (
        <li key={`${index}-${item.label}`} className={inline ? "inline" : undefined}>
          {inline && index > 0 ? <span aria-hidden> · </span> : null}
          {item.label}:{" "}
          {item.full ? (
            <span className="font-mono" title={item.full}>
              {item.value}
            </span>
          ) : (
            item.value
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Read-only log ([AJU-10]): nothing here edits or deletes. A table when the page is at least 768 px wide and its
 * column has room for it (about 640 px, measured on the column itself: the settings menu takes part of the page);
 * cards otherwise. The time goes under the day and the details under what was done, so four columns are enough
 * and every row is about two lines tall.
 */
export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="@container">
      <div className="hidden rounded-xl border md:@min-[40rem]:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Fecha</TableHead>
              <TableHead className="w-36">Quién</TableHead>
              <TableHead>Qué hizo</TableHead>
              <TableHead className="w-32">Sobre</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={cn(CELL, "tabular-nums")}>
                  {row.day}
                  <span className="mt-0.5 block text-xs text-muted-foreground">{row.time}</span>
                </TableCell>
                <TableCell className={CELL}>
                  <Who row={row} />
                </TableCell>
                <TableCell className={cn(CELL, "space-y-0.5")}>
                  <p title={row.actionCode}>{row.action}</p>
                  <Details items={row.details} inline />
                </TableCell>
                <TableCell className={CELL}>{row.target ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="grid gap-3 md:@min-[40rem]:hidden">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1 rounded-xl border p-4 text-sm wrap-anywhere">
            <p className="font-medium">{row.action}</p>
            <p className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
              <Who row={row} />
              <span className="tabular-nums">
                {row.day}, {row.time}
              </span>
              {row.target ? <span>{row.target}</span> : null}
            </p>
            <Details items={row.details} />
          </li>
        ))}
      </ul>
    </div>
  );
}
