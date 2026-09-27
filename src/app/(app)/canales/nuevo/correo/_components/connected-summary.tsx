import { CircleCheck } from "lucide-react";
import Link from "next/link";
import type { PermissionCheck } from "../_lib/permissions";
import { PermissionList } from "./permission-list";

type ConnectedSummaryProps = {
  emailAddress: string | null;
  /** Gmail and Outlook: each required permission and whether it was granted ([COR-03], [COR-07]). */
  permissions: PermissionCheck[];
  /** IMAP/SMTP: the servers it works with ([COR-11]). */
  servers: { imap: string | null; smtp: string | null } | null;
  /** Just back from Google or Microsoft (or just connected): announced to screen readers. */
  justConnected: boolean;
  reconnectHref: string;
};

/** Top of «Respuestas»: the mailbox is connected, with which address, permissions or servers. */
export function ConnectedSummary({ emailAddress, permissions, servers, justConnected, reconnectHref }: ConnectedSummaryProps) {
  return (
    <section role={justConnected ? "status" : undefined} aria-label="Buzón conectado" className="grid max-w-2xl gap-3 rounded-xl border border-success/30 bg-success-soft p-4 sm:p-6">
      <p className="flex items-center gap-2 font-semibold text-success">
        <CircleCheck aria-hidden className="size-5 shrink-0" />
        {emailAddress ? `Buzón conectado: ${emailAddress}` : "Buzón conectado"}
      </p>
      {permissions.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Permisos de la cuenta</p>
          <PermissionList items={permissions} />
        </div>
      ) : null}
      {servers ? (
        <dl className="grid gap-1 text-sm">
          <div className="flex flex-wrap gap-x-1">
            <dt className="text-muted-foreground">Entrada (IMAP):</dt>
            <dd className="font-mono text-xs leading-5">{servers.imap ?? "—"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-1">
            <dt className="text-muted-foreground">Envío (SMTP):</dt>
            <dd className="font-mono text-xs leading-5">{servers.smtp ?? "—"}</dd>
          </div>
        </dl>
      ) : null}
      <p className="text-sm text-muted-foreground">
        ¿Otra cuenta o credenciales nuevas?{" "}
        <Link href={reconnectHref} className="text-primary-text underline-offset-4 hover:underline">
          Volver a conectar
        </Link>
      </p>
    </section>
  );
}
