// How Contactos shows a contact ([CTO-02], [CTO-08]): its name, an identity's phone (data, never a key, [CAN-13]),
// the conversation states of DESIGN.md and the bajas still in force. Server components only: the display name comes
// from src/data/contacts.ts, which also checks it when a contact is erased.
import { CircleCheck, CircleDot, Hand, type LucideIcon } from "lucide-react";
import type { ConsentType, ConversationStatus } from "@/lib/enums";

export { contactDisplayName } from "@/data/contacts";

/** Identities keep the phone as digits only ([WA-39]): shown with its «+». */
export function identityPhone(phone: string | null): string | null {
  if (!phone) return null;
  return /^\d+$/.test(phone) ? `+${phone}` : phone;
}

/** Conversation states of DESIGN.md: token, icon and text. */
export const CONVERSATION_STATUS_VIEW: Record<ConversationStatus, { label: string; icon: LucideIcon; className: string }> = {
  open: { label: "Abierta", icon: CircleDot, className: "bg-info-soft text-info" },
  pending_human: { label: "Pendiente de humano", icon: Hand, className: "bg-warning-soft text-warning" },
  resolved: { label: "Resuelta", icon: CircleCheck, className: "bg-success-soft text-success" },
};

export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  legal_acceptance: "Aceptó los textos legales",
  opt_out: "Baja",
  opt_in: "Alta",
};

type ConsentEntry = { type: ConsentType; channelId: string | null; channelName: string | null; createdAt: Date };
export type ActiveOptOut = { channelId: string | null; channelName: string | null; since: Date };

/** Channels where the latest choice is a baja ([CTO-08]); an «alta» after it lifts it. Newest first. */
export function activeOptOuts(consents: ConsentEntry[]): ActiveOptOut[] {
  const latest = new Map<string, ConsentEntry>();
  for (const consent of consents) {
    if (consent.type === "legal_acceptance") continue;
    const key = consent.channelId ?? "";
    const current = latest.get(key);
    if (!current || consent.createdAt > current.createdAt) latest.set(key, consent);
  }
  return [...latest.values()]
    .filter((consent) => consent.type === "opt_out")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((consent) => ({ channelId: consent.channelId, channelName: consent.channelName, since: consent.createdAt }));
}
