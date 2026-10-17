import { ChevronLeft, ChevronRight, Pencil, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCampaign, type CampaignDetail, type CampaignRecipientItem, notStarted } from "@/data/campaigns";
import { getBusinessProfile } from "@/data/settings";
import { CAMPAIGN_ROUTE_NAMES } from "@/lib/campaigns";
import { formatCurrencyUSD, formatDateTime, formatNumber } from "@/lib/format";
import { can, PERMISSIONS } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { contactPath } from "../../contactos/_lib/search-params";
import { CampaignControls } from "../_components/campaign-controls";
import { CampaignStatusBadge } from "../_components/campaign-status-badge";
import { rulePath } from "../_lib/rules";
import { campaignPath, CAMPAIGNS_PATH, editCampaignPath, RECIPIENT_STATUS_LABELS, resultsPageFromSearchParams } from "../_lib/view";

export const metadata: Metadata = { title: "Envío" };

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * One envío ([ENV-10], [ENV-12]): what it sends and when, why it is paused, the totals and the cost by WhatsApp, and
 * each contact with its channel and state (failed and not sent, with the reason). Owner and admin change, pause,
 * resume or cancel it.
 */
export default async function CampaignPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: campaignPath(id) });
  if (!can(actor, PERMISSIONS.campaigns.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const page = resultsPageFromSearchParams(await searchParams);
  let campaign: CampaignDetail;
  try {
    campaign = await getCampaign(actor, id, { page });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { timezone } = await getBusinessProfile(actor);
  const manage = can(actor, PERMISSIONS.campaigns.manage);
  const seesContacts = can(actor, PERMISSIONS.contacts.view);
  const { totals } = campaign;
  const actions = manage ? (
    <>
      {notStarted(campaign) ? (
        <Button asChild variant="outline">
          <Link href={editCampaignPath(campaign.id)}>
            <Pencil aria-hidden />
            Cambiar
          </Link>
        </Button>
      ) : null}
      <CampaignControls campaignId={campaign.id} status={campaign.status} />
    </>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Envíos", href: CAMPAIGNS_PATH }, { label: campaign.name }]} title={campaign.name} actions={actions} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <CampaignStatusBadge status={campaign.status} />
        <span>{whenText(campaign, timezone)}</span>
        <span>
          {formatNumber(campaign.recipients)} {campaign.recipients === 1 ? "contacto" : "contactos"}
        </span>
        {campaign.createdByName ? <span>Lo programó {campaign.createdByName}</span> : null}
        {campaign.rule ? (
          <span>
            Lo hizo{" "}
            <Link href={rulePath(campaign.rule.id)} className="text-primary-text underline-offset-4 hover:underline">
              «{campaign.rule.name}»
            </Link>
          </span>
        ) : null}
      </div>

      {campaign.status === "paused" && campaign.pausedReason ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {campaign.pausedBy === "system" ? "Se ha parado solo: " : ""}
            {campaign.pausedReason}
            {campaign.pausedBy === "system" ? " Cuando lo resuelvas, pulsa «Reanudar»: se vuelve a comprobar quién puede recibirlo y a quien ya falló no se le vuelve a intentar." : ""}
          </span>
        </p>
      ) : null}

      <section aria-labelledby="envio-totales" className="grid gap-3">
        <h2 id="envio-totales" className="text-base font-semibold">
          Resultados
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Pendientes", totals.pending + totals.sending],
            ["Enviados", totals.sent],
            ["Entregados", totals.delivered],
            ["Leídos", totals.read],
            ["Fallidos", totals.failed],
            ["No enviados", totals.not_sent],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border p-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatNumber(Number(value))}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          «Entregado» y «Leído» solo existen en WhatsApp: Telegram no avisa a los bots y los correos no se rastrean, así que allí se quedan en «Enviado».
          {campaign.routes.includes("whatsapp") ? ` Coste estimado por WhatsApp: ${formatCurrencyUSD(campaign.costEstimate)}.` : ""}
        </p>
      </section>

      <section aria-labelledby="envio-mensaje" className="grid gap-3">
        <h2 id="envio-mensaje" className="text-base font-semibold">
          Mensaje
        </h2>
        <dl className="grid gap-3 text-sm">
          {campaign.whatsapp ? (
            <div className="rounded-xl border p-3">
              <dt className="font-medium">WhatsApp · {campaign.channelNames[campaign.whatsapp.channelId] ?? "número borrado"}</dt>
              <dd className="text-muted-foreground">
                Plantilla {campaign.whatsapp.templateName} · {campaign.whatsapp.templateLanguage}
              </dd>
            </div>
          ) : null}
          {campaign.telegram ? (
            <div className="rounded-xl border p-3">
              <dt className="font-medium">Telegram · {campaign.channelNames[campaign.telegram.channelId] ?? "bot borrado"}</dt>
              <dd className="whitespace-pre-wrap text-muted-foreground">{campaign.telegram.text}</dd>
            </div>
          ) : null}
          {campaign.email ? (
            <div className="rounded-xl border p-3">
              <dt className="font-medium">Correo · {campaign.email.subject}</dt>
              <dd className="whitespace-pre-wrap text-muted-foreground">{campaign.email.body}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="envio-contactos" className="grid gap-3">
        <h2 id="envio-contactos" className="text-base font-semibold">
          Contactos
        </h2>
        <div className="hidden rounded-xl border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contacto</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Enviado</TableHead>
                {campaign.routes.includes("whatsapp") ? <TableHead className="text-right">Coste estimado</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.recipientsPage.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-64 truncate">
                    <ContactName row={row} link={seesContacts} />
                  </TableCell>
                  <TableCell>{row.channel ? CAMPAIGN_ROUTE_NAMES[row.channel] : "—"}</TableCell>
                  <TableCell>{RECIPIENT_STATUS_LABELS[row.status]}</TableCell>
                  <TableCell className="max-w-72 text-muted-foreground">{row.reason ?? ""}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.sentAt ? formatDateTime(row.sentAt, timezone) : ""}</TableCell>
                  {campaign.routes.includes("whatsapp") ? (
                    <TableCell className="text-right tabular-nums">{row.costEstimate !== null ? formatCurrencyUSD(row.costEstimate) : ""}</TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="grid gap-3 md:hidden">
          {campaign.recipientsPage.map((row) => (
            <li key={row.id} className="grid gap-1 rounded-xl border p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">
                  <ContactName row={row} link={seesContacts} />
                </span>
                <span>{RECIPIENT_STATUS_LABELS[row.status]}</span>
              </div>
              <p className="text-muted-foreground">
                {[row.channel ? CAMPAIGN_ROUTE_NAMES[row.channel] : null, row.sentAt ? formatDateTime(row.sentAt, timezone) : null, row.reason].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
        {campaign.pages > 1 ? (
          <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground tabular-nums">
              Página {campaign.page} de {campaign.pages}
            </p>
            <div className="flex gap-2">
              {campaign.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={campaignPath(campaign.id, campaign.page - 1)}>
                    <ChevronLeft aria-hidden />
                    Anterior
                  </Link>
                </Button>
              ) : null}
              {campaign.page < campaign.pages ? (
                <Button asChild variant="outline">
                  <Link href={campaignPath(campaign.id, campaign.page + 1)}>
                    Siguiente
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </div>
          </nav>
        ) : null}
      </section>
    </div>
  );
}

function whenText(campaign: CampaignDetail, timezone: string): string {
  if (campaign.cancelledAt) return `Cancelado el ${formatDateTime(campaign.cancelledAt, timezone)}`;
  if (campaign.finishedAt) return `Terminó el ${formatDateTime(campaign.finishedAt, timezone)}`;
  if (campaign.startedAt) return `Empezó el ${formatDateTime(campaign.startedAt, timezone)}`;
  return `Sale el ${formatDateTime(campaign.scheduledAt, timezone)}`;
}

/** A contact erased or anonymized stays as a row without a name ([CTO-07], [CUM-05]). */
function ContactName({ row, link }: { row: CampaignRecipientItem; link: boolean }) {
  const name = row.contactName?.trim() || (row.contactId ? "Cliente sin nombre" : "Contacto borrado");
  if (!row.contactId || !link) return <>{name}</>;
  return (
    <Link href={contactPath(row.contactId)} className="underline-offset-4 hover:underline">
      {name}
    </Link>
  );
}
