import { Clock, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getCampaignRule, type CampaignRuleDetail } from "@/data/campaign-rules";
import { getBusinessProfile } from "@/data/settings";
import { CAMPAIGN_ROUTE_NAMES } from "@/lib/campaigns";
import { formatDateTime, formatNumber } from "@/lib/format";
import { can, PERMISSIONS } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { CampaignStatusBadge } from "../../_components/campaign-status-badge";
import { RuleControls } from "../../_components/rule-controls";
import { RuleStatusBadge } from "../../_components/rule-status-badge";
import { editRulePath, RULE_KIND_LABELS, rulePath, ruleSummary } from "../../_lib/rules";
import { campaignPath, CAMPAIGNS_PATH } from "../../_lib/view";

export const metadata: Metadata = { title: "Envío automático o repetido" };

type PageProps = { params: Promise<{ id: string }> };

/**
 * One automatic or repeated envío ([ENV-15], [ENV-16]): when it goes and for whom, its next time, its message and the
 * envíos it made, each with its results. Owner and admin change, activate, pause or delete it.
 */
export default async function RulePage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: rulePath(id) });
  if (!can(actor, PERMISSIONS.campaigns.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  let rule: CampaignRuleDetail;
  try {
    rule = await getCampaignRule(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { timezone } = await getBusinessProfile(actor);
  const manage = can(actor, PERMISSIONS.campaigns.manage);
  const actions = manage ? (
    <>
      <Button asChild variant="outline">
        <Link href={editRulePath(rule.id)}>
          <Pencil aria-hidden />
          Cambiar
        </Link>
      </Button>
      <RuleControls ruleId={rule.id} status={rule.status} />
    </>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Envíos", href: CAMPAIGNS_PATH }, { label: rule.name }]} title={rule.name} description={RULE_KIND_LABELS[rule.kind]} actions={actions} />

      <div className="grid gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
          <RuleStatusBadge status={rule.status} />
          <span>{rule.routes.map((route) => CAMPAIGN_ROUTE_NAMES[route]).join(", ")}</span>
          {rule.createdByName ? <span>Lo creó {rule.createdByName}</span> : null}
        </div>
        <p>{ruleSummary(rule, { services: rule.serviceNames, channels: rule.channelNames })}</p>
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Clock aria-hidden className="size-4" />
          {rule.status === "paused"
            ? "En pausa: no hace envíos hasta que lo actives."
            : rule.waiting
              ? "Esperando a que termine el envío anterior: en cuanto termine, sale el siguiente."
              : rule.nextRunAt
                ? `Próxima vez: ${formatDateTime(rule.nextRunAt, timezone)}.`
                : null}
        </p>
      </div>

      <section aria-labelledby="regla-mensaje" className="grid gap-3">
        <h2 id="regla-mensaje" className="text-base font-semibold">
          Mensaje
        </h2>
        <dl className="grid gap-3 text-sm">
          {rule.whatsapp ? (
            <div className="rounded-xl border p-3">
              <dt className="font-medium">WhatsApp · {rule.channelNames[rule.whatsapp.channelId] ?? "número borrado"}</dt>
              <dd className="text-muted-foreground">
                Plantilla {rule.whatsapp.templateName} · {rule.whatsapp.templateLanguage}
              </dd>
            </div>
          ) : null}
          {rule.telegram ? (
            <div className="rounded-xl border p-3">
              <dt className="font-medium">Telegram · {rule.channelNames[rule.telegram.channelId] ?? "bot borrado"}</dt>
              <dd className="whitespace-pre-wrap text-muted-foreground">{rule.telegram.text}</dd>
            </div>
          ) : null}
          {rule.email ? (
            <div className="rounded-xl border p-3">
              <dt className="font-medium">Correo · {rule.email.subject}</dt>
              <dd className="whitespace-pre-wrap text-muted-foreground">{rule.email.body}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="regla-envios" className="grid gap-3">
        <h2 id="regla-envios" className="text-base font-semibold">
          Envíos que ha hecho
        </h2>
        {rule.envios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún ninguno. Cada vez que sale, aparece aquí y en Envíos con sus resultados.</p>
        ) : (
          <ul className="grid gap-2">
            {rule.envios.map((envio) => (
              <li key={envio.id} className="relative flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm hover:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
                <Link href={campaignPath(envio.id)} className="min-w-0 truncate font-medium outline-none after:absolute after:inset-0">
                  {envio.name}
                </Link>
                <span className="flex items-center gap-3 text-muted-foreground">
                  {formatNumber(envio.recipients)} {envio.recipients === 1 ? "contacto" : "contactos"}
                  <CampaignStatusBadge status={envio.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
