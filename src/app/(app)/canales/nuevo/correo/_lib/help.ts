// «¿Dónde lo encuentro?» of the email wizard ([COR-02], [COR-07], [COR-10], [AJU-17], DESIGN.md › Formularios): for each
// Google, Microsoft or mail-server datum, 2–4 short steps (docs/integracion-correo.md §1–§3) and the section of the email
// guide (docs/guia-correo.md), which Ayuda serves inside the app. Pure.
import type { FieldHelp } from "../../whatsapp/_lib/help";

export type { FieldHelp };

export const EMAIL_GUIDE_PATH = "/ayuda/correo";

/** Sections of docs/guia-correo.md the wizard links to. */
export const GUIDE_ANCHORS = [
  "gmail",
  "google-cloud",
  "pantalla-de-consentimiento",
  "credenciales",
  "produccion",
  "outlook",
  "entra",
  "permisos",
  "secreto",
  "consentimiento-admin",
  "imap",
  "contrasena-de-aplicacion",
  "problemas",
] as const;
export type GuideAnchor = (typeof GUIDE_ANCHORS)[number];

export function guideHref(anchor?: GuideAnchor): string {
  return anchor ? `${EMAIL_GUIDE_PATH}#${anchor}` : EMAIL_GUIDE_PATH;
}

export type EmailHelpField =
  | "googleRedirectUri"
  | "googleClientId"
  | "googleClientSecret"
  | "microsoftRedirectUri"
  | "microsoftClientId"
  | "microsoftClientSecret"
  | "microsoftSecretExpiry"
  | "microsoftTenant"
  | "mailPassword"
  | "mailServers";

export const FIELD_HELP: Record<EmailHelpField, FieldHelp> = {
  googleRedirectUri: {
    title: "URI de redirección autorizada",
    steps: [
      "En Google Cloud, abre el proyecto del negocio y ve a Google Auth Platform › Clients.",
      "Crea un cliente de tipo «Web application» (Aplicación web).",
      "En «Authorized redirect URIs» pega esta dirección tal cual y guarda.",
    ],
    href: guideHref("credenciales"),
  },
  googleClientId: {
    title: "Client ID de Google",
    steps: [
      "En Google Cloud, ve a Google Auth Platform › Clients y abre el cliente web que creaste.",
      "Copia el «Client ID»: termina en .apps.googleusercontent.com.",
    ],
    href: guideHref("credenciales"),
  },
  googleClientSecret: {
    title: "Client Secret de Google",
    steps: [
      "Está en el mismo cliente web, en «Client secrets».",
      "Si no puedes verlo, añade un secreto nuevo y cópialo al momento.",
      "Se guarda cifrado y no se vuelve a mostrar.",
    ],
    href: guideHref("credenciales"),
  },
  microsoftRedirectUri: {
    title: "URI de redirección de Microsoft",
    steps: [
      "En el centro de administración de Microsoft Entra, abre tu app en «App registrations».",
      "Ve a «Authentication», añade la plataforma «Web» y pega esta dirección tal cual.",
    ],
    href: guideHref("entra"),
  },
  microsoftClientId: {
    title: "Client ID (Application ID)",
    steps: [
      "En Microsoft Entra, abre tu app en «App registrations».",
      "En «Overview», copia el «Application (client) ID».",
    ],
    href: guideHref("entra"),
  },
  microsoftClientSecret: {
    title: "Client Secret de Microsoft",
    steps: [
      "En tu app de Entra, ve a «Certificates & secrets» › «Client secrets» › «New client secret».",
      "Copia la columna «Value» (no el «Secret ID»): Microsoft solo la enseña una vez.",
    ],
    href: guideHref("secreto"),
  },
  microsoftSecretExpiry: {
    title: "Caducidad del Client Secret",
    steps: [
      "Es la fecha de la columna «Expires» del secreto, en «Certificates & secrets».",
      "Microsoft la limita a 24 meses. Te avisaremos 30 días antes para que pongas uno nuevo.",
    ],
    href: guideHref("secreto"),
  },
  microsoftTenant: {
    title: "Tenant ID",
    steps: [
      "Con Microsoft 365 del negocio: el «Directory (tenant) ID» del «Overview» de tu app.",
      "Con Outlook.com o Hotmail, o si la app admite cuentas personales: «common».",
    ],
    href: guideHref("entra"),
  },
  mailPassword: {
    title: "Contraseña del buzón",
    steps: [
      "Con un hosting (IONOS, Hostinger, cPanel…), es la contraseña del buzón.",
      "Gmail, Yahoo, iCloud y Zoho con verificación en dos pasos piden una contraseña de aplicación: créala en la seguridad de tu cuenta.",
      "Se guarda cifrada y no se vuelve a mostrar.",
    ],
    href: guideHref("contrasena-de-aplicacion"),
  },
  mailServers: {
    title: "Servidores IMAP y SMTP",
    steps: [
      "Se rellenan solos según el dominio de tu correo; revísalos.",
      "Si no son esos, búscalos en la ayuda de tu proveedor («configurar el correo en un programa»).",
      "IMAP lee el correo (puerto 993, SSL/TLS) y SMTP lo envía (465 SSL/TLS o 587 STARTTLS).",
    ],
    href: guideHref("imap"),
  },
};
