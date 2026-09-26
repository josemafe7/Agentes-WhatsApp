// System email texts (Spanish, «tú»): invitation, password reset and the SMTP test. Plain text plus simple, escaped
// HTML with the business name, logo and colour ([AJU-01]).
import "server-only";
import { primaryCssVars } from "@/lib/color";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/format";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export type EmailContent = { subject: string; text: string; html: string };

/** What the system emails show of the business ([AJU-01]): its name, colour and the absolute URL of its logo. */
export type EmailBrand = { name: string; color: string; logoUrl: string | null };

/** Lifetime of password reset links (Better Auth `resetPasswordTokenExpiresIn`, [USU-10]). */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

const DEFAULT_NAME = "DominIA Agentes";
const LOGO_HEIGHT_PX = 40;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function businessName(brand: EmailBrand): string {
  return brand.name.trim() || DEFAULT_NAME;
}

function header(brand: EmailBrand): string {
  const name = escapeHtml(businessName(brand));
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" height="${LOGO_HEIGHT_PX}" ` +
      `style="display:block;height:${LOGO_HEIGHT_PX}px;width:auto;margin:0 0 12px;border:0">`
    : "";
  return `<div style="margin:0 0 24px">${logo}<p style="margin:0;font-weight:bold">${name}</p></div>`;
}

function layout(brand: EmailBrand, paragraphs: string[], button: { label: string; url: string } | null, footer: string): string {
  // The colour as the panel shows it on a white surface, with its readable text colour (src/lib/color.ts).
  const { light } = primaryCssVars(brand.color);
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("");
  const action = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:${light["--primary"]};` +
      `color:${light["--primary-foreground"]};padding:12px 20px;border-radius:6px;text-decoration:none;` +
      `display:inline-block">${escapeHtml(button.label)}</a></p>`
    : "";
  return (
    `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f4f5;` +
    `font-family:Arial,Helvetica,sans-serif;color:#18181b;font-size:15px;line-height:1.5">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">` +
    `${header(brand)}${body}${action}` +
    `<p style="margin:0;color:#65656f;font-size:13px">${escapeHtml(footer)}</p></div></body></html>`
  );
}

export function invitationEmail(params: {
  brand: EmailBrand;
  inviterName: string | null;
  role: Role;
  link: string;
  expiresAt: Date;
  timezone?: string;
}): EmailContent {
  const business = businessName(params.brand);
  const who = params.inviterName ? `${params.inviterName} te ha invitado` : "Te han invitado";
  const role = ROLE_LABELS[params.role];
  const until = formatDateTime(params.expiresAt, params.timezone ?? DEFAULT_TIMEZONE, { preset: "datetime" });
  const intro = `${who} a unirte al equipo de ${business} en DominIA Agentes con el rol ${role}.`;
  const steps = "Abre el enlace, escribe tu nombre y elige una contraseña para crear tu cuenta.";
  const footer = `El enlace sirve una sola vez y caduca el ${until}. Si no esperabas esta invitación, ignora este correo.`;
  return {
    subject: `Invitación al equipo de ${business}`,
    text: `Hola:\n\n${intro}\n\n${steps}\n\n${params.link}\n\n${footer}\n`,
    html: layout(params.brand, ["Hola:", intro, steps], { label: "Aceptar la invitación", url: params.link }, footer),
  };
}

export function passwordResetEmail(params: { brand: EmailBrand; name: string | null; link: string }): EmailContent {
  const business = businessName(params.brand);
  const greeting = params.name ? `Hola, ${params.name}:` : "Hola:";
  const intro = `Has pedido cambiar tu contraseña de ${business}. Abre el enlace para elegir una nueva.`;
  const hours = PASSWORD_RESET_TTL_SECONDS / 3600;
  const footer =
    `El enlace sirve una sola vez y caduca en ${hours === 1 ? "1 hora" : `${hours} horas`}. ` +
    "Si no lo has pedido tú, ignora este correo: tu contraseña no cambia.";
  return {
    subject: `Cambia tu contraseña de ${business}`,
    text: `${greeting}\n\n${intro}\n\n${params.link}\n\n${footer}\n`,
    html: layout(params.brand, [greeting, intro], { label: "Elegir una contraseña nueva", url: params.link }, footer),
  };
}

/** «Enviar correo de prueba» of Ajustes › Correo del sistema ([AJU-06]). */
export function testEmail(params: { brand: EmailBrand; name: string }): EmailContent {
  const business = businessName(params.brand);
  const greeting = `Hola, ${params.name}:`;
  const intro =
    `Este es un correo de prueba de ${business}. Si lo estás leyendo, el correo del sistema funciona: ` +
    "las invitaciones, los enlaces de recuperación y los avisos saldrán por aquí.";
  const footer = "Lo has pedido desde Ajustes › Correo del sistema.";
  return {
    subject: `Correo de prueba de ${business}`,
    text: `${greeting}\n\n${intro}\n`,
    html: layout(params.brand, [greeting, intro], null, footer),
  };
}
