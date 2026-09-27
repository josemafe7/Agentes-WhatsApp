import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChannelType } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { contactPath } from "../_lib/search-params";
import { ChannelIcons } from "./channel-icons";
import { LabelBadges } from "./label-badges";

export type ContactRow = {
  id: string;
  displayName: string;
  /** False when the contact has no name and the display name is its email or phone. */
  hasName: boolean;
  phone: string | null;
  email: string | null;
  labels: string[];
  channelTypes: ChannelType[];
  /** «hace 3 h» and the full date for the tooltip; null without conversations. */
  lastConversation: { relative: string; full: string } | null;
};

function ContactLink({ row, stretched }: { row: ContactRow; stretched?: boolean }) {
  return (
    <Link
      href={contactPath(row.id)}
      className={cn(
        "rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none",
        !row.hasName && "text-muted-foreground",
        // On cards the whole card is the link, and the card shows the focus ring.
        stretched ? "after:absolute after:inset-0 after:rounded-xl" : "focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      {row.displayName}
    </Link>
  );
}

function ContactData({ row }: { row: ContactRow }) {
  // The display name already shows the email or phone of a contact without a name.
  const lines = [row.phone, row.email].filter((value): value is string => Boolean(value) && value !== row.displayName);
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="grid min-w-0">
      {lines.map((line) => (
        <span key={line} className="truncate" title={line}>
          {line}
        </span>
      ))}
    </span>
  );
}

function LastConversation({ row }: { row: ContactRow }) {
  if (!row.lastConversation) return <span className="text-muted-foreground">—</span>;
  return (
    <time title={row.lastConversation.full} className="tabular-nums">
      {row.lastConversation.relative}
    </time>
  );
}

/** The list of Contactos ([CTO-01]): a table from 768 px, cards below. The name opens the card. */
export function ContactsTable({ rows }: { rows: ContactRow[] }) {
  return (
    <>
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Canales</TableHead>
              <TableHead>Teléfono o email</TableHead>
              <TableHead>Etiquetas</TableHead>
              <TableHead>Última conversación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-64 truncate">
                  <ContactLink row={row} />
                </TableCell>
                <TableCell>
                  <ChannelIcons types={row.channelTypes} />
                </TableCell>
                <TableCell className="max-w-64">
                  <ContactData row={row} />
                </TableCell>
                <TableCell>
                  <LabelBadges labels={row.labels} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <LastConversation row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="relative grid gap-1.5 rounded-xl border p-4 text-sm hover:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                <ContactLink row={row} stretched />
              </span>
              <ChannelIcons types={row.channelTypes} />
            </div>
            <div className="text-muted-foreground">
              <ContactData row={row} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <LabelBadges labels={row.labels} />
              {row.lastConversation ? <LastConversation row={row} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
