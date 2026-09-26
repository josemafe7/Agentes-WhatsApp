import { FlaskConical, Mail, RadioTower } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { StatusLight } from "@/components/status-light";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DiagnosticsView } from "../_lib/view";
import { JobActions } from "./job-actions";

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function DatabaseSection({ database }: { database: DiagnosticsView["database"] }) {
  const detail = [database.driverLabel, database.latency ? `responde en ${database.latency}` : null, database.size ? `ocupa ${database.size}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section title="Base de datos">
      <StatusLight status={database.status} label="Conexión" detail={database.status === "ok" ? detail : "No responde. Revisa DATABASE_URL y que la base exista."} />
      <StatusLight
        status={database.migrationsStatus}
        label="Migraciones"
        detail={
          database.pendingMigrations.length > 0
            ? `${database.migrationsLabel}. Faltan: ${database.pendingMigrations.join(", ")}. Ejecuta pnpm db:migrate.`
            : database.migrationsLabel
        }
      />
    </Section>
  );
}

export function QueueSection({ queue }: { queue: DiagnosticsView["queue"] }) {
  return (
    <Section title="Trabajo en segundo plano" description="Respuestas de la IA, correos, sincronizaciones y limpiezas que se hacen por turnos.">
      <StatusLight
        status={queue.tickStatus}
        label="Última ronda"
        detail={
          queue.lastTick
            ? `${queue.lastTick.when} · ${queue.lastTick.completed} hechos, ${queue.lastTick.failed} con error`
            : "Todavía no se ha ejecutado ninguna. En local la lanza pnpm dev cada unos 15 s; publicada, el cron."
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Pendientes" value={queue.counts.pending} hint={queue.counts.due > 0 ? `${queue.counts.due} ya tocan` : null} />
        <Stat label="En curso" value={queue.counts.running} />
        <Stat label="Fallidos" value={queue.counts.failed} />
        <Stat label="Más antiguo por hacer" value={queue.oldestDue ?? "—"} />
      </div>
      {queue.jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay trabajos con errores.</p>
      ) : (
        // Technical table: horizontal scroll is allowed here (DESIGN.md «Tablas y listas»).
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trabajo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Intentos</TableHead>
                <TableHead>Último error</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.jobs.map((job) => (
                <TableRow key={job.id} className="align-top">
                  <TableCell>
                    <p className="font-mono text-xs">{job.type}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{job.when}</p>
                  </TableCell>
                  <TableCell>
                    {job.statusLabel}
                    {job.nextAttempt ? <p className="text-xs text-muted-foreground">Próximo intento {job.nextAttempt}</p> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{job.attempts}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal text-sm">{job.error}</TableCell>
                  <TableCell>
                    <JobActions jobId={job.id} type={job.type} canRetry={job.canRetry} canCancel={job.canCancel} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}

export function RealtimeSection({ realtime }: { realtime: DiagnosticsView["realtime"] }) {
  return (
    <Section title="Tiempo real" description="Cambios que las pantallas abiertas recogen cada pocos segundos.">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Eventos guardados" value={realtime.count} />
        <Stat label="Último" value={realtime.last ?? "Ninguno"} />
      </div>
    </Section>
  );
}

export function WebhooksSection({ webhooks }: { webhooks: DiagnosticsView["webhooks"] }) {
  if (webhooks.channels.length === 0 && !webhooks.unknown) {
    return (
      <Section title="Último aviso por canal">
        <EmptyState
          icon={RadioTower}
          title="Todavía no hay canales de WhatsApp ni de Telegram"
          description="Cuando conectes uno, aquí verás cuándo llegó su último aviso."
        />
      </Section>
    );
  }
  return (
    <Section title="Último aviso por canal" description="Cuándo llegó el último aviso (webhook) de cada canal.">
      <ul className="divide-y">
        {webhooks.channels.map((channel) => (
          <li key={channel.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="font-medium">{channel.name}</span>
              <span className="text-muted-foreground">{channel.typeLabel}</span>
              {channel.isDemo ? <Badge variant="secondary">Demo</Badge> : null}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {channel.last ? `${channel.last} · ${channel.count} guardados` : "Ninguno todavía"}
            </span>
          </li>
        ))}
        {webhooks.unknown ? (
          <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="font-medium">Números que no son de ningún canal</span>
            <span className="text-muted-foreground tabular-nums">
              {webhooks.unknown.last} · {webhooks.unknown.count}
            </span>
          </li>
        ) : null}
      </ul>
    </Section>
  );
}

export function EmailsSection({ emails }: { emails: DiagnosticsView["emails"] }) {
  return (
    <Section
      id="bandeja-local"
      title="Correos del sistema"
      description={
        emails.outboxEnabled
          ? "Los últimos enviados. En local, sin servidor de correo, se guardan en la bandeja local: ábrelos para copiar sus enlaces."
          : "Los últimos enviados por el correo del sistema."
      }
    >
      {emails.items.length === 0 ? (
        <EmptyState icon={Mail} title="Todavía no ha salido ningún correo" description="Aquí aparecerán las invitaciones, las recuperaciones de contraseña y los avisos." />
      ) : (
        <ul className="divide-y">
          {emails.items.map((email) => (
            <li key={email.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{email.kindLabel}</Badge>
                  <span className="truncate font-medium">{email.subject}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Para {email.toEmail} · {email.when} ·{" "}
                  <span className={email.status === "failed" ? "text-destructive-text" : undefined}>{email.statusLabel}</span>
                  {email.error ? ` (${email.error})` : ""}
                </p>
              </div>
              {email.canOpen ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/ajustes/diagnostico/bandeja-local/${email.id}`}>Abrir</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function SimulatorCard() {
  return (
    <Section title="Simulador de canales">
      <EmptyState
        icon={FlaskConical}
        title="Llegará junto con los canales"
        description="Podrás enviar mensajes de prueba como si fueras un cliente (texto, audio, imagen o documento) y ver cómo responde la IA, sin que nada salga a WhatsApp ni al correo."
      />
    </Section>
  );
}
