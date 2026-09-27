// Server settings filled in by the address's domain ([COR-10], docs/integracion-correo.md §3.1, checked in each
// provider's own help). They are suggestions the person can change. Microsoft addresses and servers go to the
// Outlook option: Microsoft no longer takes passwords for IMAP/POP and turns SMTP with password off by default at
// the end of 2026 ([COR-09]). Port 25 never appears (and is refused). Pure.
import "server-only";

export type MailSecurityMode = "tls" | "starttls";
export type MailServer = { host: string; port: number; security: MailSecurityMode };
export type MailPreset = {
  id: string;
  name: string;
  imap: MailServer;
  smtp: MailServer;
  /** What the person must know (app password, paid plan…). */
  note?: string;
  /** The server keeps a copy of what SMTP sends: no APPEND to Sent (Gmail, [F25]). */
  savesSent?: boolean;
  /** iCloud: the IMAP user is the name without the domain. */
  imapUserWithoutDomain?: boolean;
};

const tls = (host: string, port = 993): MailServer => ({ host, port, security: "tls" });
const smtpTls = (host: string): MailServer => ({ host, port: 465, security: "tls" });
const smtpStarttls = (host: string): MailServer => ({ host, port: 587, security: "starttls" });

export const MAIL_PRESETS = {
  gmail: {
    id: "gmail",
    name: "Gmail (contraseña de aplicación)",
    imap: tls("imap.gmail.com"),
    smtp: smtpTls("smtp.gmail.com"),
    note: "Necesita una contraseña de aplicación de 16 caracteres y la verificación en dos pasos activada. Es más sencillo conectar con «Gmail».",
    savesSent: true,
  },
  yahoo: { id: "yahoo", name: "Yahoo Mail", imap: tls("imap.mail.yahoo.com"), smtp: smtpTls("smtp.mail.yahoo.com"), note: "Necesita una contraseña de aplicación." },
  icloud: {
    id: "icloud",
    name: "iCloud Mail",
    imap: tls("imap.mail.me.com"),
    smtp: smtpStarttls("smtp.mail.me.com"),
    note: "Necesita una contraseña específica de app. En IMAP el usuario es el nombre sin el dominio.",
    imapUserWithoutDomain: true,
  },
  zoho: { id: "zoho", name: "Zoho Mail", imap: tls("imap.zoho.com"), smtp: smtpTls("smtp.zoho.com"), note: "IMAP solo está en los planes de pago. Actívalo en los ajustes de Zoho Mail." },
  zohoPro: { id: "zohoPro", name: "Zoho Mail (dominio propio)", imap: tls("imappro.zoho.com"), smtp: smtpTls("smtppro.zoho.com"), note: "IMAP solo está en los planes de pago." },
  ionosEs: { id: "ionosEs", name: "IONOS España", imap: tls("imap.ionos.es"), smtp: smtpTls("smtp.ionos.es") },
  ionos: { id: "ionos", name: "IONOS", imap: tls("imap.ionos.com"), smtp: smtpTls("smtp.ionos.com") },
  hostinger: { id: "hostinger", name: "Hostinger", imap: tls("imap.hostinger.com"), smtp: smtpTls("smtp.hostinger.com"), note: "Usuario: la dirección completa." },
  ovh: { id: "ovh", name: "OVHcloud (MX Plan)", imap: tls("ssl0.ovh.net"), smtp: smtpTls("ssl0.ovh.net"), note: "Usuario: la dirección completa." },
  strato: { id: "strato", name: "STRATO", imap: tls("imap.strato.de"), smtp: smtpTls("smtp.strato.de") },
  gmxDe: { id: "gmxDe", name: "GMX (gmx.net, gmx.de)", imap: tls("imap.gmx.net"), smtp: smtpStarttls("mail.gmx.net"), note: "Activa POP3/IMAP en los ajustes de GMX." },
  gmx: { id: "gmx", name: "GMX (gmx.com)", imap: tls("imap.gmx.com"), smtp: smtpStarttls("mail.gmx.com"), note: "Activa POP3/IMAP en los ajustes de GMX." },
} as const satisfies Record<string, MailPreset>;
export type MailPresetId = keyof typeof MAIL_PRESETS;

/** Hosting providers offered when the domain is the business's own. */
export const HOSTING_PRESET_IDS: readonly MailPresetId[] = ["ionosEs", "ionos", "hostinger", "ovh", "strato", "zohoPro"];

const DOMAIN_PRESETS: Record<string, MailPresetId> = {
  "gmail.com": "gmail",
  "googlemail.com": "gmail",
  "yahoo.com": "yahoo",
  "yahoo.es": "yahoo",
  "ymail.com": "yahoo",
  "rocketmail.com": "yahoo",
  "icloud.com": "icloud",
  "me.com": "icloud",
  "mac.com": "icloud",
  "zohomail.com": "zoho",
  "zoho.com": "zoho",
  "gmx.net": "gmxDe",
  "gmx.de": "gmxDe",
  "gmx.com": "gmx",
  "gmx.es": "gmx",
};

/** Microsoft's consumer domains: only through the Outlook option ([COR-09]). */
export const MICROSOFT_DOMAINS = ["outlook.com", "outlook.es", "hotmail.com", "hotmail.es", "live.com", "live.es", "msn.com"];
/** Microsoft servers: a mailbox on them is connected with the Outlook option ([COR-09]). */
const MICROSOFT_HOST_SUFFIXES = ["office365.com", "outlook.com", "office.com", "hotmail.com", "live.com"];

export type MailSuggestion =
  | { kind: "microsoft" }
  | { kind: "preset"; preset: MailPreset }
  /** The business's own domain: cPanel's usual «mail.{domain}» and the hosting presets to choose from. */
  | { kind: "own_domain"; preset: MailPreset; hosting: MailPreset[] };

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

export function suggestMailSettings(email: string): MailSuggestion | null {
  const domain = domainOf(email);
  if (!domain) return null;
  if (MICROSOFT_DOMAINS.includes(domain)) return { kind: "microsoft" };
  const known = DOMAIN_PRESETS[domain];
  if (known) return { kind: "preset", preset: MAIL_PRESETS[known] };
  const cpanel: MailPreset = {
    id: "cpanel",
    name: "cPanel u otro hosting",
    imap: tls(`mail.${domain}`),
    smtp: smtpTls(`mail.${domain}`),
    note: "Datos habituales de cPanel. Si tu hosting es otro, elígelo en la lista o copia los datos de su ayuda.",
  };
  return { kind: "own_domain", preset: cpanel, hosting: HOSTING_PRESET_IDS.map((id) => MAIL_PRESETS[id]) };
}

export function isMicrosoftMailHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  return MICROSOFT_HOST_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

/** Gmail's servers keep what SMTP sends in Sent by themselves ([F25]). */
export function savesSentAutomatically(host: string): boolean {
  const name = host.trim().toLowerCase();
  return name === "imap.gmail.com" || name === "smtp.gmail.com";
}
