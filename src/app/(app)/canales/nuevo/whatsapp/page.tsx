import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Stepper } from "@/components/stepper";
import { listAgents } from "@/data/agents";
import { getChannel, listChannels, type ChannelDetail } from "@/data/channels";
import { getBusinessProfile } from "@/data/settings";
import { getWhatsAppWebhookSetup, isPublicHttpsUrl } from "@/data/whatsapp";
import { getWhatsAppPanel, type WhatsAppPanel } from "@/data/whatsapp-panel";
import { WHATSAPP_WEBHOOK_FIELDS } from "@/lib/meta/client";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { appUrl } from "@/server/app-url";
import { whatsappWebhookUrl } from "@/server/channels/whatsapp/config";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { channelPath } from "../../_lib/webchat";
import { ActivateStep } from "./_components/activate-step";
import { AgentStep } from "./_components/agent-step";
import { ConnectFlow } from "./_components/connect-flow";
import { TestStep } from "./_components/test-step";
import { WebhookStep } from "./_components/webhook-step";
import { nextChannelStep, parseChannelStep, previousChannelStep, resumeStep, WA_WIZARD_PATH, WIZARD_STEPS, wizardHref, type ChannelStep } from "./_lib/steps";

export const metadata: Metadata = { title: "Conectar WhatsApp" };

type WhatsAppWizardProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STEPPER_STEPS = WIZARD_STEPS.map(({ id, label }) => ({ id, label }));

const STEP_INTRO: Record<ChannelStep, { title: string; description: string }> = {
  webhook: { title: "Dirección de avisos", description: "Conectamos la app de Meta con esta instalación para que lleguen los mensajes de tus clientes." },
  activar: { title: "Activar el número", description: "Registramos el número en la API de WhatsApp y repasamos lo que Meta necesita para que funcione." },
  prueba: { title: "Prueba", description: "Comprueba que los mensajes llegan y salen antes de encender la IA." },
  agente: { title: "Agente", description: "Elige quién contesta en este número. Empieza en modo pruebas: la IA solo contesta a los números que pongas." },
};

const BREADCRUMBS = [
  { label: "Canales", href: "/canales" },
  { label: "Añadir canal", href: "/canales/nuevo" },
  { label: "WhatsApp" },
];

/** A WhatsApp channel of this installation for the wizard, or null (another type, a demo channel or none). */
async function wizardChannel(actor: Actor, channelId: string): Promise<ChannelDetail | null> {
  try {
    const channel = await getChannel(actor, channelId);
    return channel.type === "whatsapp" && !channel.isDemo ? channel : null;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

type StepContext = { actor: Actor; channel: ChannelDetail; panel: WhatsAppPanel; timezone: string; backHref: string; nextHref: string };

/** The content of a step of an existing number, with only the data that step needs. */
async function channelStep(step: ChannelStep, { actor, channel, panel, timezone, backHref, nextHref }: StepContext): Promise<ReactNode> {
  switch (step) {
    case "webhook": {
      const setup = await getWhatsAppWebhookSetup(actor);
      return (
        <WebhookStep
          channelId={channel.id}
          callbackUrl={setup.callbackUrl}
          verifyToken={setup.verifyToken}
          verifiedAt={setup.verifiedAt?.toISOString() ?? null}
          timezone={timezone}
          recommendedFields={WHATSAPP_WEBHOOK_FIELDS.filter((field) => field !== "messages")}
          nextHref={nextHref}
        />
      );
    }
    case "activar":
      return (
        <ActivateStep
          channelId={channel.id}
          isMetaTestNumber={panel.isMetaTestNumber}
          hasPin={panel.secrets?.hasPin ?? false}
          register={{ left: panel.register.left, nextFreeAt: panel.register.nextFreeAt?.toISOString() ?? null }}
          appLiveConfirmed={panel.config.appLiveConfirmed}
          paymentConfirmed={panel.paymentMethodConfirmedAt !== null}
          templates={panel.templates}
          legalUrls={{ terms: appUrl("/legal/terminos"), privacy: appUrl("/legal/privacidad"), deletion: appUrl("/legal/eliminacion-datos") }}
          timezone={timezone}
          backHref={backHref}
          nextHref={nextHref}
        />
      );
    case "prueba":
      return (
        <TestStep
          channelId={channel.id}
          displayPhoneNumber={panel.displayPhoneNumber}
          isMetaTestNumber={panel.isMetaTestNumber}
          since={new Date().toISOString()}
          timezone={timezone}
          backHref={backHref}
          nextHref={nextHref}
        />
      );
    case "agente": {
      const agents = await listAgents(actor);
      return (
        <AgentStep
          channelId={channel.id}
          channelName={channel.name}
          agents={agents.map(({ id, name }) => ({ id, name }))}
          activeAgent={channel.activeAgent}
          aiEnabled={channel.aiEnabled}
          testMode={channel.testMode}
          testAllowlist={channel.testAllowlist}
          backHref={backHref}
          finishHref={channelPath(channel.id)}
        />
      );
    }
  }
}

/**
 * Asistente de WhatsApp (docs/pantallas.md, [WA-01]–[WA-25]): owner and admin ([PER-04]). Without `canal`, Pasos 0 y 1;
 * with it, the step in `paso` (or where the number was left), so the setup can be resumed. A disconnected number
 * goes back to its data (same channel, same history).
 */
export default async function WhatsAppWizardPage({ searchParams }: WhatsAppWizardProps) {
  const params = await searchParams;
  const canal = typeof params.canal === "string" && idSchema.safeParse(params.canal).success ? params.canal : null;
  const requested = parseChannelStep(params.paso);
  const actor = await requirePageActor({ next: canal ? wizardHref(canal, requested ?? undefined) : WA_WIZARD_PATH });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const publicHttps = isPublicHttpsUrl(whatsappWebhookUrl());
  /** Another real number is connected: its app's App Secret may be reused ([WA-10]). */
  const otherNumbers = async (exceptId: string | null) =>
    (await listChannels(actor)).some((channel) => channel.type === "whatsapp" && !channel.isDemo && channel.id !== exceptId);

  if (params.canal === undefined) {
    return (
      <>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Conectar WhatsApp" description="Tu número con la API oficial de Meta, paso a paso." />
        <ConnectFlow hasOtherNumbers={await otherNumbers(null)} publicHttps={publicHttps} reconnect={null} />
      </>
    );
  }

  const channel = canal ? await wizardChannel(actor, canal) : null;
  if (!channel) notFound();
  const [panel, profile] = await Promise.all([getWhatsAppPanel(actor, channel.id), getBusinessProfile(actor)]);
  const numberLine = [panel.name, panel.displayPhoneNumber].filter(Boolean).join(" · ");

  if (!panel.hasCredentials) {
    return (
      <>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Conectar WhatsApp" description={`Vuelve a conectar ${numberLine}: su historial se conserva.`} />
        <ConnectFlow
          hasOtherNumbers={await otherNumbers(channel.id)}
          publicHttps={publicHttps}
          reconnect={{ channelId: channel.id, name: panel.name, isMetaTestNumber: panel.isMetaTestNumber }}
        />
      </>
    );
  }

  const resumed = resumeStep({ hasCredentials: true, status: panel.status, webhookStatus: panel.webhookStatus });
  const step: ChannelStep = requested ?? (resumed === "datos" ? "webhook" : resumed);
  const hrefOf = (target: ChannelStep | null) => (target ? wizardHref(channel.id, target) : channelPath(channel.id));
  const content = await channelStep(step, {
    actor,
    channel,
    panel,
    timezone: profile.timezone,
    backHref: hrefOf(previousChannelStep(step)),
    nextHref: hrefOf(nextChannelStep(step)),
  });

  return (
    <>
      <PageHeader breadcrumbs={BREADCRUMBS} title="Conectar WhatsApp" description={numberLine} />
      <div className="grid gap-8">
        <Stepper steps={STEPPER_STEPS} current={step} />
        <section aria-labelledby="wa-step-title" className="grid gap-6">
          <header className="grid gap-1">
            <h2 id="wa-step-title" className="text-lg font-semibold">
              {STEP_INTRO[step].title}
            </h2>
            <p className="text-sm text-muted-foreground">{STEP_INTRO[step].description}</p>
          </header>
          {content}
        </section>
      </div>
    </>
  );
}
