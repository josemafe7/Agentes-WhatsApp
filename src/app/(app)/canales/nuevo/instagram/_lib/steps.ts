// The Instagram wizard (docs/pantallas.md «Asistente de Instagram», [IG-01]): four steps in one address. An account that
// was disconnected comes back through the same wizard, with its channel in the address (?canal=…). The links are the
// official Meta pages of docs/integracion-instagram.md «Fuentes». Pure.

export const IG_WIZARD_PATH = "/canales/nuevo/instagram";

export const IG_WIZARD_STEPS = [
  { id: "preparar", label: "Prepara tu app de Meta" },
  { id: "conectar", label: "Conectar la cuenta" },
  { id: "avisos", label: "Avisos de Meta" },
  { id: "probar", label: "Prueba" },
] as const;
export type InstagramWizardStep = (typeof IG_WIZARD_STEPS)[number]["id"];

/** The guide of Instagram inside the app ([AJU-17]). */
export const INSTAGRAM_GUIDE_HREF = "/ayuda/instagram";

/** Sections of docs/guia-instagram.md the wizard links to (a test checks the guide has each one). */
export const INSTAGRAM_GUIDE_ANCHORS = {
  needs: "que-necesitas",
  app: "crear-la-app-de-meta",
  token: "token",
  secret: "clave-secreta",
  webhook: "avisos-de-meta",
  publish: "publicar-la-app",
  test: "prueba",
  problems: "problemas",
} as const;

/** «/ayuda/instagram#token»: a section of the guide. */
export function instagramGuideHref(section: keyof typeof INSTAGRAM_GUIDE_ANCHORS): string {
  return `${INSTAGRAM_GUIDE_HREF}#${INSTAGRAM_GUIDE_ANCHORS[section]}`;
}

/** Official Meta pages (docs/integracion-instagram.md «Fuentes»), for the steps done in Meta's panel. */
export const INSTAGRAM_META_LINKS = {
  /** [F3] Create a Meta app of type Business with the Instagram product. */
  createApp: "https://developers.facebook.com/documentation/development/create-an-app/other-app-types/instagram-apis",
  /** [F5] Add the account and generate its token in the app's panel. */
  getStarted: "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started",
  /** [F6] Where the «Instagram app secret» is (Business login settings). */
  businessLogin: "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login",
  /** [F11] Configure webhooks: callback URL, verify token and the «messages» field. */
  webhooks: "https://developers.facebook.com/documentation/instagram-platform/webhooks",
  /** [F42] Publish the app (Live): Meta only sends webhooks to a published app. */
  publish: "https://developers.facebook.com/documentation/development/release",
} as const;

/** Address of the wizard to connect again the account of a channel. */
export function instagramWizardHref(channelId: string): string {
  return `${IG_WIZARD_PATH}?${new URLSearchParams({ canal: channelId }).toString()}`;
}

/** «@cuenta» with the «@» only once, whatever was stored. */
export function instagramHandle(username: string): string {
  return `@${username.replace(/^@+/, "")}`;
}
