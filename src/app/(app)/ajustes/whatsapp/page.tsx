import { ExternalLink, Info } from "lucide-react";
import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getBusinessProfile } from "@/data/settings";
import { getWhatsAppWebhookSetup } from "@/data/whatsapp";
import { listPricingRates } from "@/data/whatsapp-pricing";
import { formatDateTime } from "@/lib/format";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { PricingRates } from "./_components/pricing-rates";
import { WebhookAddress } from "./_components/webhook-address";
import { marketName, META_PRICING_DOCS_URL, META_RATES_URL } from "./_lib/labels";

export const metadata: Metadata = { title: "WhatsApp" };

function ExternalTextLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-text underline-offset-4 hover:underline">
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only"> (se abre en una pestaña nueva)</span>
    </a>
  );
}

/**
 * Ajustes › WhatsApp ([AJU-09], docs/pantallas.md): the per-message rates by market and category used to estimate what
 * Meta charges ([WA-47]), and the installation's webhook address with its verify token ([WA-12]). Owner and admin;
 * supervisor, agent and Solo lectura get «Sin permiso» ([PER-03], [PER-04]).
 */
export default async function WhatsAppSettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/whatsapp" });
  if (!can(actor, PERMISSIONS.settings.business)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const [rates, profile, webhook] = await Promise.all([
    listPricingRates(actor),
    getBusinessProfile(actor),
    can(actor, PERMISSIONS.channels.manage) ? getWhatsAppWebhookSetup(actor) : Promise.resolve(null),
  ]);
  const hasExamples = rates.some((rate) => rate.isExample);

  return (
    <div className="space-y-8">
      <PageHeader title="WhatsApp" description="Las tarifas con las que se estima lo que cobra Meta y la dirección de avisos de la instalación." />

      <section aria-labelledby="whatsapp-rates-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="whatsapp-rates-heading" className="text-lg font-semibold">
            Tarifas
          </h2>
          <p className="text-sm text-muted-foreground">
            Precio por mensaje de cada mercado y categoría, en dólares (US$). Con ellos se calcula el coste estimado de cada mensaje enviado.
          </p>
        </div>

        <Alert className="border-info/30 bg-info-soft text-info">
          <Info aria-hidden />
          <AlertTitle>Los precios nunca vienen escritos en la app</AlertTitle>
          <AlertDescription className="grid gap-2 text-info">
            <p>
              Los pones tú, copiados de la tabla oficial de Meta en dólares, y los cambias cuando Meta los cambie (solo lo hace el 1 de enero, abril, julio
              u octubre). <ExternalTextLink href={META_RATES_URL}>Ver las tarifas de Meta</ExternalTextLink> ·{" "}
              <ExternalTextLink href={META_PRICING_DOCS_URL}>Cómo cobra Meta</ExternalTextLink>
            </p>
            {hasExamples ? <p>Las tarifas marcadas «Ejemplo» son de la demo: no son precios reales. Cámbialas por las de tus mercados.</p> : null}
          </AlertDescription>
        </Alert>

        <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            El coste solo se estima en los mensajes que Meta marca como cobrados en su estado. Los gratuitos, como los 1.000 mensajes de servicio al mes
            de cada número, cuentan 0: Meta lo indica en cada mensaje, así que no se configuran aquí.
          </li>
          <li>Desde el 1-10-2026, los mensajes de servicio (las respuestas dentro de la ventana de 24 horas) se cobran a la tarifa de utilidad de cada mercado.</li>
          <li>
            El mercado sale del prefijo del teléfono del cliente o, si no lo hay, del país de su identificador de WhatsApp. Meta agrupa algunos países en
            regiones («Resto de…»): pon la tarifa de la región en cada país que te interese.
          </li>
          <li>Sin tarifa para un mercado y una categoría, esos mensajes no tienen coste estimado y el informe lo señala.</li>
        </ul>

        <PricingRates
          rates={rates.map((rate) => ({
            id: rate.id,
            country: rate.country,
            market: marketName(rate.country),
            category: rate.category,
            price: rate.price,
            currency: rate.currency,
            isExample: rate.isExample,
            updated: formatDateTime(rate.updatedAt, profile.timezone, { preset: "date" }),
          }))}
        />
      </section>

      {webhook ? (
        <section aria-labelledby="whatsapp-webhook-heading" className="space-y-4">
          <div className="space-y-1">
            <h2 id="whatsapp-webhook-heading" className="text-lg font-semibold">
              Dirección de avisos
            </h2>
            <p className="text-sm text-muted-foreground">
              Una sola para toda la instalación y todos sus números. El asistente de WhatsApp la configura en Meta; si no puede, cópiala aquí en tu app de
              Meta, en WhatsApp › Configuración.
            </p>
          </div>
          <WebhookAddress setup={webhook} timezone={profile.timezone} />
        </section>
      ) : null}
    </div>
  );
}
