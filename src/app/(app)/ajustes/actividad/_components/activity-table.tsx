import { Bot, Cog, User } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditActorType } from "@/lib/enums";

export type ActivityRow = {
  id: string;
  when: string;
  actorType: AuditActorType;
  who: string;
  action: string;
  actionCode: string;
  target: string | null;
  details: string[];
};

const ACTOR_ICONS = { user: User, ai: Bot, system: Cog } as const;

function Who({ row }: { row: ActivityRow }) {
  const Icon = ACTOR_ICONS[row.actorType];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {row.who}
    </span>
  );
}

function Details({ lines }: { lines: string[] }) {
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** Read-only log: a table from 768 px, cards below. Nothing here edits or deletes ([AJU-10]). */
export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <>
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Quién</TableHead>
              <TableHead>Qué hizo</TableHead>
              <TableHead>Sobre</TableHead>
              <TableHead>Detalles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="align-top">
                <TableCell className="whitespace-nowrap tabular-nums">{row.when}</TableCell>
                <TableCell>
                  <Who row={row} />
                </TableCell>
                <TableCell title={row.actionCode}>{row.action}</TableCell>
                <TableCell>{row.target ?? "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <Details lines={row.details} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1 rounded-xl border p-4 text-sm">
            <p className="font-medium">{row.action}</p>
            <p className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
              <Who row={row} />
              <span className="tabular-nums">{row.when}</span>
              {row.target ? <span>{row.target}</span> : null}
            </p>
            <Details lines={row.details} />
          </li>
        ))}
      </ul>
    </>
  );
}
