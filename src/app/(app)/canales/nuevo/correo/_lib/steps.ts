// Steps and addresses of the email wizard (docs/pantallas.md «Asistente de correo», [COR-01]). Before the mailbox
// exists the address is /canales/nuevo/correo (optionally ?tipo=… with the provider chosen); from then on it carries
// the channel (?canal=…&paso=…), so the setup can be left and resumed, and «Conectar con Google / Microsoft» comes back
// to it (DESIGN.md › Asistentes). Pure: shared by the page, the client steps and the channel panel.
import type { ChannelStatus } from "@/lib/enums";
import type { EmailChannelType } from "@/server/channels/email/config";

export const EMAIL_WIZARD_PATH = "/canales/nuevo/correo";

export const EMAIL_WIZARD_STEPS = [
  { id: "conectar", label: "Conectar el buzón" },
  { id: "respuestas", label: "Respuestas y agente" },
] as const;
export type EmailWizardStep = (typeof EMAIL_WIZARD_STEPS)[number]["id"];

export type EmailProviderOption = {
  type: EmailChannelType;
  label: string;
  description: string;
  /** Name the channel gets unless the person writes another. */
  defaultName: string;
};

/** The dropdown of [COR-01], in this order. */
export const EMAIL_PROVIDER_OPTIONS: readonly EmailProviderOption[] = [
  { type: "email_gmail", label: "Gmail", description: "Con tu propio proyecto de Google Cloud. Sin contraseñas.", defaultName: "Gmail" },
  {
    type: "email_outlook",
    label: "Outlook / Microsoft 365",
    description: "Con tu propia app de Microsoft Entra. Para Outlook.com, Hotmail y Microsoft 365.",
    defaultName: "Outlook",
  },
  {
    type: "email_imap",
    label: "Otro (IMAP/SMTP)",
    description: "Cualquier otro correo: tu hosting, Yahoo, iCloud, Zoho… con su contraseña o una de aplicación.",
    defaultName: "Correo",
  },
];

export function parseEmailProvider(value: unknown): EmailChannelType | null {
  return EMAIL_PROVIDER_OPTIONS.find((option) => option.type === value)?.type ?? null;
}

export function parseEmailStep(value: unknown): EmailWizardStep | null {
  return EMAIL_WIZARD_STEPS.find((step) => step.id === value)?.id ?? null;
}

/**
 * The step shown: a mailbox that is not connected, needs reconnecting or has just failed to connect is in «Conectar»
 * (the settings wait until it works); a connected one goes on to «Respuestas» unless «Conectar» is asked (reconnect).
 */
export function wizardStepFor(channel: { status: ChannelStatus; reconnect: boolean }, requested: EmailWizardStep | null, connectionFailed: boolean): EmailWizardStep {
  if (channel.status === "draft" || channel.reconnect || connectionFailed) return "conectar";
  return requested ?? "respuestas";
}

/** A new mailbox; with a provider, the dropdown starts on it. */
export function newEmailWizardHref(provider?: EmailChannelType): string {
  return provider ? `${EMAIL_WIZARD_PATH}?${new URLSearchParams({ tipo: provider }).toString()}` : EMAIL_WIZARD_PATH;
}

/** A mailbox being set up (without step: where it was left). */
export function emailWizardHref(channelId: string, step?: EmailWizardStep): string {
  const query = new URLSearchParams({ canal: channelId, ...(step ? { paso: step } : {}) });
  return `${EMAIL_WIZARD_PATH}?${query.toString()}`;
}
