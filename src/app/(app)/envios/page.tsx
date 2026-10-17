import { CalendarClock, ChevronLeft, ChevronRight, Megaphone, Repeat, Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCampaignRules, type CampaignRuleItem } from "@/data/campaign-rules";
import { listCampaigns, type CampaignListItem } from "@/data/campaigns";
import { listServices } from "@/data/agenda-config";
import { listInboxChannels } from "@/data/channels";
import { getBusinessProfile } from "@/data/settings";
import { CAMPAIGN_ROUTE_NAMES } from "@/lib/campaigns";
import { formatDateTime, formatNumber } from "@/lib/format";
import { can, PERMISSIONS } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { requirePageActor } from "@/server/session";
import { CampaignRules } from "./_components/campaign-rules";
import { CampaignStatusBadge } from "./_components/campaign-status-badge";
import { RuleStatusBadge } from "./_components/rule-status-badge";
import { NEW_RULE_PATH, RULE_KIND_LABELS, rulePath, ruleSummary } from "./_lib/rules";
import { campaignPath, CAMPAIGNS_PATH, campaignsPath, NEW_CAMPAIGN_PATH, resultsPageFromSearchParams } from "./_lib/view";

export const metadata: Metadata = { title: "Envíos" };

/**
 * Envíos ([ENV-01]): each envío with its state, when it goes out, by which channels, to how many contacts and its
 * results, 25 a page; the rules in a few lines ([CUM-15]). Owner and admin program them; supervisor and Solo lectura see
 * them.
 */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor({ next: CAMPAIGNS_PATH });
  if (!can(actor, PERMISSIONS.campaigns.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const [list, profile, rules] = await Promise.all([listCampaigns(actor, { page: resultsPageFromSearchParams(await searchParams) }), getBusinessProfile(actor), listCampaignRules(actor)]);
  const { items } = list;
  const [services, channels] = await Promise.all([can(actor, PERMISSIONS.agenda.view) ? listServices(actor) : [], listInboxChannels(actor)]);
  const names = { services: Object.fromEntries(services.map((service) => [service.id, service.name])), channels: Object.fromEntries(channels.map((channel) => [channel.id, channel.name])) };
  const manage = can(actor, PERMISSIONS.campaigns.manage);
  const healthData = profile.sector ? getSectorPreset(profile.sector).healthData : false;
  const newCampaign = manage ? (
    <Button asChild>
      <Link href={NEW_CAMPAIGN_PATH}>
        <Send aria-hidden />
        Programar envío
      </Link>
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Envíos"
        description="Novedades y publicidad para tus contactos por WhatsApp, Telegram o correo, solo a quien dio su permiso."
        actions={newCampaign}
      />
      <CampaignRules healthData={healthData} />
      <AutomaticAndRepeated rules={rules} manage={manage} names={names} timezone={profile.timezone} />
      <h2 className="text-base font-semibold">Envíos</h2>
      {items.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Megaphone}
            title="Aún no hay envíos"
            description={manage ? "Marca contactos en Contactos y pulsa «Programar envío», o prográmalo aquí para todos." : "Cuando el negocio programe uno, aparecerá aquí con sus resultados."}
            action={newCampaign ?? undefined}
          />
        </div>
      ) : (
        <>
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cuándo</TableHead>
                  <TableHead>Canales</TableHead>
                  <TableHead className="text-right">Contactos</TableHead>
                  <TableHead>Resultados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-64 truncate">
                      <Link href={campaignPath(item.id)} className="font-medium underline-offset-4 hover:underline">
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(item.scheduledAt, profile.timezone)}</TableCell>
                    <TableCell>{routesText(item)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.recipients)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{resultsText(item)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-3 md:hidden">
            {items.map((item) => (
              <li key={item.id} className="relative grid gap-1.5 rounded-xl border p-4 text-sm hover:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
                <div className="flex items-center justify-between gap-3">
                  <Link href={campaignPath(item.id)} className="min-w-0 truncate font-medium outline-none after:absolute after:inset-0">
                    {item.name}
                  </Link>
                  <CampaignStatusBadge status={item.status} />
                </div>
                <p className="text-muted-foreground">
                  {formatDateTime(item.scheduledAt, profile.timezone)} · {routesText(item)} · {formatNumber(item.recipients)} {item.recipients === 1 ? "contacto" : "contactos"}
                </p>
                <p className="text-xs text-muted-foreground">{resultsText(item)}</p>
              </li>
            ))}
          </ul>
          {list.pages > 1 ? (
            <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-muted-foreground tabular-nums">
                Página {list.page} de {list.pages}
              </p>
              <div className="flex gap-2">
                {list.page > 1 ? (
                  <Button asChild variant="outline">
                    <Link href={campaignsPath(list.page - 1)}>
                      <ChevronLeft aria-hidden />
                      Anterior
                    </Link>
                  </Button>
                ) : null}
                {list.page < list.pages ? (
                  <Button asChild variant="outline">
                    <Link href={campaignsPath(list.page + 1)}>
                      Siguiente
                      <ChevronRight aria-hidden />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

/** [ENV-01] Apart from the envíos: the automatic ones after a booking and the repeated ones ([ENV-15], [ENV-16]). */
function AutomaticAndRepeated({ rules, manage, names, timezone }: { rules: CampaignRuleItem[]; manage: boolean; names: { services: Record<string, string>; channels: Record<string, string> }; timezone: string }) {
  return (
    <section aria-labelledby="envios-automaticos" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="envios-automaticos" className="text-base font-semibold">
          Automáticos y repetidos
        </h2>
        {manage ? (
          <Button asChild variant="outline">
            <Link href={NEW_RULE_PATH}>
              <Repeat aria-hidden />
              Nuevo automático o repetido
            </Link>
          </Button>
        ) : null}
      </div>
      {rules.length === 0 ? (
        <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
          Ninguno todavía. Uno sale solo unos días después de cada cita (por ejemplo, para pedir una opinión), y otro cada semana o cada mes a los contactos con una etiqueta.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rules.map((rule) => (
            <li key={rule.id} className="relative grid gap-1 rounded-xl border p-3 text-sm hover:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={rulePath(rule.id)} className="min-w-0 truncate font-medium outline-none after:absolute after:inset-0">
                  {rule.name}
                </Link>
                <RuleStatusBadge status={rule.status} />
              </div>
              <p className="text-muted-foreground">
                {RULE_KIND_LABELS[rule.kind]} · {ruleSummary(rule, names)} · {rule.routes.map((route) => CAMPAIGN_ROUTE_NAMES[route]).join(", ")}
              </p>
              {rule.status === "active" && rule.nextRunAt ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock aria-hidden className="size-3.5" />
                  {rule.waiting ? "Esperando a que termine el envío anterior" : `Próxima vez: ${formatDateTime(rule.nextRunAt, timezone)}`}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function routesText(item: CampaignListItem): string {
  return item.routes.map((route) => CAMPAIGN_ROUTE_NAMES[route]).join(", ");
}

/** Sent (delivered and read count as sent), failed and not sent; what is still waiting, when some is. */
function resultsText(item: CampaignListItem): string {
  const { totals } = item;
  const sent = totals.sent + totals.delivered + totals.read;
  const waiting = totals.pending + totals.sending;
  const parts = [`${formatNumber(sent)} enviados`, `${formatNumber(totals.failed)} fallidos`, `${formatNumber(totals.not_sent)} no enviados`];
  if (waiting > 0 && item.status !== "cancelled") parts.push(`${formatNumber(waiting)} pendientes`);
  return parts.join(" · ");
}
