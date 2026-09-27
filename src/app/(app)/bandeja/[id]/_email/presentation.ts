// How the inbox shows an email of the thread (DESIGN.md «Bandeja y conversación» › «Correo»): addresses, the body
// without the subject line the AI gets, our signature apart, and what the folded part and the approval say. Pure.
import type { EmailAddressView } from "@/data/email-drafts";

/** Addresses shown before «y N más». */
const MAX_ADDRESSES = 8;
const SIGNATURE_SEPARATOR = "\n-- \n";

/** «Ana López <ana@cliente.test>», or only the address. */
export function formatAddress(address: EmailAddressView): string {
  const name = address.name?.trim();
  return name ? `${name} <${address.address}>` : address.address;
}

export function formatAddresses(addresses: readonly EmailAddressView[]): string {
  const shown = addresses.slice(0, MAX_ADDRESSES).map(formatAddress).join(", ");
  const more = addresses.length - MAX_ADDRESSES;
  return more > 0 ? `${shown} y ${more} más` : shown;
}

/**
 * The first email of a thread reaches the AI with an «Asunto: …» line on top (the subject is often the question); the
 * card shows the subject apart, so the body goes without it.
 */
export function emailBody(text: string | null, subject: string | null): string {
  const body = text ?? "";
  if (!subject) return body;
  const line = `Asunto: ${subject}`;
  if (body === line) return "";
  return body.startsWith(`${line}\n\n`) ? body.slice(line.length + 2) : body;
}

/** The text before the last «-- » line (RFC 3676 §4.3) and the signature after it, shown apart and quieter. */
export function splitSignature(text: string): { body: string; signature: string | null } {
  const normalized = `\n${text.replace(/\r\n?/g, "\n")}`;
  const at = normalized.lastIndexOf(SIGNATURE_SEPARATOR);
  if (at === -1) return { body: text, signature: null };
  return { body: normalized.slice(1, at).trimEnd(), signature: normalized.slice(at + SIGNATURE_SEPARATOR.length).trim() || null };
}

/** Under an AI reply a person approved from the inbox ([CAN-07]). */
export function approvalLabel(view: { approvedBy: string | null; edited: boolean }): string | null {
  if (!view.approvedBy) return null;
  return view.edited ? `Editado y enviado por ${view.approvedBy}` : `Revisado y enviado por ${view.approvedBy}`;
}

/** The folded part of an email ([COR-19]): the quoted history, or the whole email when its text was cut. */
export function originalTextLabels(view: { quoted: boolean; truncated: boolean }): { show: string; hide: string } | null {
  if (view.truncated) return { show: "Ver el correo completo", hide: "Ocultar el correo completo" };
  if (view.quoted) return { show: "Mostrar el texto citado", hide: "Ocultar el texto citado" };
  return null;
}
