import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Stepper } from "@/components/stepper";
import { listAgents } from "@/data/agents";
import { getChannel } from "@/data/channels";
import { getEmailChannelView, googleRedirectUri, microsoftRedirectUri, type EmailChannelView } from "@/data/email";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { MAX_DAILY_CAP, MAX_SIGNATURE } from "@/server/channels/email/constants";
import { AI_NOTICE_AUTOMATIC, AI_NOTICE_REVIEWED } from "@/server/channels/email/signature";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { channelPath } from "../../_lib/webchat";
import { ConnectStep } from "./_components/connect-step";
import { ConnectedSummary } from "./_components/connected-summary";
import { ConnectionNotice } from "./_components/connection-notice";
import { RepliesStep } from "./_components/replies-step";
import { grantedPermissions, readConnectionOutcome, type ConnectionOutcome } from "./_lib/connection";
import { wizardMailbox } from "./_lib/mailbox";
import { EMAIL_WIZARD_PATH, EMAIL_WIZARD_STEPS, emailWizardHref, parseEmailProvider, parseEmailStep, wizardStepFor, type EmailWizardStep } from "./_lib/steps";

export const metadata: Metadata = { title: "Conectar correo" };

type EmailWizardProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STEPPER_STEPS = EMAIL_WIZARD_STEPS.map(({ id, label }) => ({ id, label }));
const TITLE = "Conectar correo";
const BREADCRUMBS = [
  { label: "Canales", href: "/canales" },
  { label: "Añadir canal", href: "/canales/nuevo" },
  { label: "Correo" },
];
/** Microsoft makes a Client Secret last 24 months at most ([COR-07]); the date input offers up to then. */
const MAX_SECRET_MONTHS = 24;

const STEP_INTRO: Record<EmailWizardStep, { title: string; description: string }> = {
  conectar: {
    title: "Conectar el buzón",
    description: "Con Gmail y Outlook usas tu propia app de Google o Microsoft: nadie más la comparte. Con «Otro», los datos de tu servidor de correo.",
  },
  respuestas: {
    title: "Respuestas y agente",
    description: "Cómo contesta la IA en este buzón. Empieza con borradores: tú decides qué sale.",
  },
};

/** Today and 24 months ahead as the date input wants them (AAAA-MM-DD). */
function secretExpiryRange(now: Date): { min: string; max: string } {
  const max = new Date(now);
  max.setUTCMonth(max.getUTCMonth() + MAX_SECRET_MONTHS);
  return { min: now.toISOString().slice(0, 10), max: max.toISOString().slice(0, 10) };
}

/** A real mailbox of this installation for the wizard, or null (another type, a demo mailbox or none, [ARR-11]). */
async function wizardView(actor: Actor, channelId: string): Promise<EmailChannelView | null> {
  try {
    const view = await getEmailChannelView(actor, channelId);
    return view.isDemo ? null : view;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/** «Respuestas y agente» of a connected mailbox, with what it connected with on top. */
async function RepliesContent({ actor, view, outcome }: { actor: Actor; view: EmailChannelView; outcome: ConnectionOutcome | null }) {
  const [channel, agents, profile] = await Promise.all([getChannel(actor, view.id), listAgents(actor), getBusinessProfile(actor)]);
  return (
    <div className="grid gap-6">
      <ConnectedSummary
        emailAddress={view.emailAddress}
        permissions={grantedPermissions(view.type, view.grantedScopes)}
        servers={view.imap ? { imap: view.imap.imapHost, smtp: view.imap.smtpHost } : null}
        justConnected={outcome?.kind === "connected"}
        reconnectHref={emailWizardHref(view.id, "conectar")}
      />
      <RepliesStep
        channelId={view.id}
        channelName={view.name}
        agents={agents.map(({ id, name }) => ({ id, name }))}
        activeAgent={channel.activeAgent}
        aiEnabled={channel.aiEnabled}
        replyMode={channel.replyMode}
        testMode={channel.testMode}
        testAllowlist={channel.testAllowlist}
        signature={view.settings.signature}
        dailyCapPerThread={view.settings.dailyCapPerThread}
        dailyCapPerSender={view.settings.dailyCapPerSender}
        limits={{ maxDailyCap: MAX_DAILY_CAP, maxSignature: MAX_SIGNATURE }}
        businessName={profile.name}
        notices={{ automatic: AI_NOTICE_AUTOMATIC, reviewed: AI_NOTICE_REVIEWED }}
        backHref={emailWizardHref(view.id, "conectar")}
        finishHref={channelPath(view.id)}
      />
    </div>
  );
}

/**
 * Asistente de correo (docs/pantallas.md, [COR-01]–[COR-11], [COR-14], [COR-17], [COR-21]–[COR-23]): owner and admin
 * ([PER-01]). Without `canal`, the dropdown and the chosen provider's screen; with it, the mailbox where it was left:
 * «Conectar» until it is connected (or when it needs reconnecting, or the return from Google or Microsoft failed), then
 * «Respuestas y agente». The OAuth callbacks come back here with `conexion`/`motivo` or `consentimiento`.
 */
export default async function EmailWizardPage({ searchParams }: EmailWizardProps) {
  const params = await searchParams;
  const canal = typeof params.canal === "string" && idSchema.safeParse(params.canal).success ? params.canal : null;
  const requested = parseEmailStep(params.paso);
  const actor = await requirePageActor({ next: canal ? emailWizardHref(canal, requested ?? undefined) : EMAIL_WIZARD_PATH });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  const redirectUris = { google: googleRedirectUri(), microsoft: microsoftRedirectUri() };
  const secretExpiry = secretExpiryRange(new Date());

  if (params.canal === undefined) {
    return (
      <WizardFrame description="Gmail, Outlook o cualquier otro correo. La IA empieza dejando borradores para que los revises." step="conectar">
        <ConnectStep
          key="new"
          mailbox={null}
          initialProvider={parseEmailProvider(params.tipo) ?? "email_gmail"}
          redirectUris={redirectUris}
          secretExpiry={secretExpiry}
          needsAdminConsent={false}
        />
      </WizardFrame>
    );
  }

  const view = canal ? await wizardView(actor, canal) : null;
  if (!view) notFound();
  const outcome = readConnectionOutcome(params);
  const step = wizardStepFor({ status: view.status, reconnect: view.reconnect !== null }, requested, outcome?.kind === "failed");

  return (
    <WizardFrame description={[view.name, view.emailAddress].filter(Boolean).join(" · ")} step={step}>
      {step === "conectar" ? (
        <>
          <ConnectionNotice type={view.type} outcome={outcome} reconnectReason={view.reconnect?.reason ?? null} />
          <ConnectStep
            key={view.id}
            mailbox={wizardMailbox(view)}
            initialProvider={view.type}
            redirectUris={redirectUris}
            secretExpiry={secretExpiry}
            needsAdminConsent={outcome?.kind === "failed" && outcome.reason === "admin_consent_required"}
          />
        </>
      ) : (
        <RepliesContent actor={actor} view={view} outcome={outcome} />
      )}
    </WizardFrame>
  );
}

/** Header, stepper and the step's title around its content (DESIGN.md › Asistentes). */
function WizardFrame({ description, step, children }: { description: string; step: EmailWizardStep; children: ReactNode }) {
  return (
    <>
      <PageHeader breadcrumbs={BREADCRUMBS} title={TITLE} description={description} />
      <div className="grid gap-8">
        <Stepper steps={STEPPER_STEPS} current={step} />
        <section aria-labelledby="email-step-title" className="grid gap-6">
          <header className="grid gap-1">
            <h2 id="email-step-title" className="text-lg font-semibold">
              {STEP_INTRO[step].title}
            </h2>
            <p className="text-sm text-muted-foreground">{STEP_INTRO[step].description}</p>
          </header>
          {children}
        </section>
      </div>
    </>
  );
}
