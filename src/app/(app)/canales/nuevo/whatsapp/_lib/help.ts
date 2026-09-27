// «¿Dónde lo encuentro?» of the WhatsApp wizard ([WA-01], [AJU-17], DESIGN.md › Formularios): for each Meta datum,
// 2–4 short steps (docs/integracion-whatsapp.md §2.4) and the section of the WhatsApp guide (docs/guia-whatsapp.md),
// which Ayuda serves inside the app; and what to do after Meta refuses the data, said for the wizard. Pure.
import { describeMetaError } from "@/lib/meta/errors";

export const WHATSAPP_GUIDE_PATH = "/ayuda/whatsapp";

/** Sections of docs/guia-whatsapp.md the wizard links to. */
export const GUIDE_ANCHORS = [
  "portfolio",
  "app",
  "numero",
  "usuario-del-sistema",
  "token",
  "app-secret",
  "phone-number-id",
  "pin",
  "webhook",
  "publicar-app",
  "metodo-de-pago",
  "plantillas",
  "prueba",
  "problemas",
] as const;
export type GuideAnchor = (typeof GUIDE_ANCHORS)[number];

export function guideHref(anchor?: GuideAnchor): string {
  return anchor ? `${WHATSAPP_GUIDE_PATH}#${anchor}` : WHATSAPP_GUIDE_PATH;
}

/**
 * Meta's Billing Hub (Centro de facturación), where the payment method of the WhatsApp account is added ([WA-21],
 * [WA-51]; docs/integracion-whatsapp.md §5.7).
 */
export const META_BILLING_HUB_URL = "https://business.facebook.com/billing_hub";

export type FieldHelp = { title: string; steps: string[]; href: string };

export type HelpField = "accessToken" | "appSecret" | "phoneNumberId" | "appId" | "wabaId" | "twoStepPin" | "graphApiVersion";

export const FIELD_HELP: Record<HelpField, FieldHelp> = {
  accessToken: {
    title: "Token permanente",
    steps: [
      "Entra en business.facebook.com › Configuración › Usuarios del sistema.",
      "Elige el usuario del sistema con acceso a tu app y a tu cuenta de WhatsApp, y pulsa «Generar token».",
      "Elige tu app, caducidad «Nunca» y los permisos whatsapp_business_messaging y whatsapp_business_management.",
    ],
    href: guideHref("token"),
  },
  appSecret: {
    title: "App Secret",
    steps: ["Abre tu app en el panel de desarrolladores de Meta.", "Ve a Configuración de la app › Básica.", "En «Clave secreta de la app», pulsa «Mostrar» y cópiala."],
    href: guideHref("app-secret"),
  },
  phoneNumberId: {
    title: "Phone Number ID",
    steps: ["Abre tu app en el panel de desarrolladores de Meta.", "Ve a WhatsApp › Configuración de la API (API Setup).", "Copia el «Phone number ID» que aparece debajo del número (no es el número de teléfono)."],
    href: guideHref("phone-number-id"),
  },
  appId: {
    title: "App ID",
    steps: ["Abre tu app en el panel de desarrolladores de Meta.", "Ve a Configuración de la app › Básica y copia el «Identificador de la app»."],
    href: guideHref("app"),
  },
  wabaId: {
    title: "WABA ID",
    steps: ["Abre tu app en el panel de desarrolladores de Meta.", "Ve a WhatsApp › Configuración de la API (API Setup).", "Copia el «WhatsApp Business Account ID»."],
    href: guideHref("phone-number-id"),
  },
  twoStepPin: {
    title: "PIN de verificación en dos pasos",
    steps: [
      "Solo si el número ya tenía verificación en dos pasos: es el PIN de 6 cifras que eligió quien lo registró.",
      "Si no lo tenía, déjalo vacío: al activar el número se crea uno nuevo, que se guarda cifrado.",
      "Si nadie lo recuerda, déjalo vacío: en el paso Activar podrás cambiarlo por uno nuevo.",
    ],
    href: guideHref("pin"),
  },
  graphApiVersion: {
    title: "Versión de la API de Meta",
    steps: ["Déjala en la que viene salvo que sepas que necesitas otra.", "Meta publica versiones nuevas varias veces al año; puedes cambiarla después en el panel del número."],
    href: guideHref("problemas"),
  },
};

/** In the wizard the token is typed right here: the panel's «Cambiar token» does not exist yet ([WA-09]). */
const WIZARD_ACTIONS: Readonly<Record<number, string>> = {
  0: "Pega aquí un token permanente nuevo del usuario del sistema.",
  190: "Pega aquí un token permanente nuevo del usuario del sistema.",
};

/** «Qué hacer» under a Meta error of «Validar con Meta», or null when there is no code. */
export function wizardErrorAction(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return WIZARD_ACTIONS[code] ?? describeMetaError(code).action;
}
