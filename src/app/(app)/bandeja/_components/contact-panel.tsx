import { Ban, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import type { ContactDetail } from "@/data/contacts";
import type { ConversationDetail } from "@/data/conversations";
import { formatDateTime, formatRelative } from "@/lib/format";
import { contactDisplayName, STATUS_META } from "../_lib/presentation";
import { ChannelMark } from "./contact-avatar";

type ContactPanelProps = {
  conversation: Pick<ConversationDetail, "id" | "contact" | "summary">;
  contact: ContactDetail | null;
  timezone: string;
  now: Date;
  /** Link to the full card in Contactos. */
  canOpenContact: boolean;
  /** The contact's next bookings and «Nueva cita» (bandeja/[id]/_bookings), right after the data. */
  bookings?: ReactNode;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b px-4 py-4 last:border-b-0">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The contact next to the conversation ([BAN-15], [CTO-02]): data, identities by channel (never the phone as a key),
 * labels, custom fields, opt-outs, the conversation summary and the other conversations the person may see.
 */
export function ContactPanel({ conversation, contact, timezone, now, canOpenContact, bookings }: ContactPanelProps) {
  const basic = contact ?? conversation.contact;
  if (!basic) {
    return <p className="px-4 py-4 text-sm text-muted-foreground">Esta conversación no tiene contacto.</p>;
  }
  const others = contact?.conversations.filter((item) => item.id !== conversation.id) ?? [];
  const optOuts = contact?.consents.filter((consent) => consent.type === "opt_out") ?? [];
  const customFields = Object.entries(contact?.customFields ?? {});

  return (
    <div className="flex flex-col">
      <Section title="Datos">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Nombre</dt>
          <dd className="min-w-0 break-words">{contactDisplayName(basic.name)}</dd>
          <dt className="text-muted-foreground">Teléfono</dt>
          <dd className="min-w-0 break-words tabular-nums">{basic.phone ?? "—"}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 break-words">{basic.email ?? "—"}</dd>
        </dl>
        {canOpenContact ? (
          <Link href={`/contactos/${basic.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline">
            Abrir la ficha completa
            <ExternalLink aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </Section>

      {bookings}

      {optOuts.length > 0 ? (
        <Section title="Bajas">
          <ul className="flex flex-col gap-1 text-sm">
            {optOuts.map((consent) => (
              <li key={consent.id} className="flex items-start gap-2 text-warning">
                <Ban aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  Se ha dado de baja{consent.channelName ? ` en ${consent.channelName}` : ""} el {formatDateTime(consent.createdAt, timezone, { preset: "date" })}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {conversation.summary ? (
        <Section title="Resumen de la conversación">
          <p className="text-sm whitespace-pre-wrap">{conversation.summary}</p>
        </Section>
      ) : null}

      {contact && contact.identities.length > 0 ? (
        <Section title="Identidades">
          <ul className="flex flex-col gap-1.5 text-sm">
            {contact.identities.map((identity) => {
              const { icon: Icon, iconClassName, label } = CHANNEL_IDENTITY[identity.channelType];
              return (
                // Channel and identifier, as in the contact's page ([CTO-02]); the name in the channel only as extra.
                <li key={identity.id} className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon aria-hidden className={`size-4 shrink-0 ${iconClassName}`} />
                    <span className="shrink-0">{label}</span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={identity.externalId}>
                      {identity.externalId}
                    </span>
                  </span>
                  {identity.displayName ? <span className="truncate pl-6 text-xs text-muted-foreground">Nombre en el canal: {identity.displayName}</span> : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {contact && contact.labels.length > 0 ? (
        <Section title="Etiquetas del contacto">
          <ul className="flex flex-wrap gap-1.5">
            {contact.labels.map((label) => (
              <li key={label} className="inline-flex h-[22px] items-center rounded-full border px-2 text-xs">
                {label}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {customFields.length > 0 ? (
        <Section title="Campos personalizados">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {customFields.map(([field, value]) => (
              <div key={field} className="contents">
                <dt className="text-muted-foreground">{field}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {others.length > 0 ? (
        <Section title="Otras conversaciones">
          <ul className="flex flex-col gap-1">
            {others.map((item) => (
              <li key={item.id}>
                <Link href={`/bandeja/${item.id}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <ChannelMark type={item.channel.type} name={item.channel.name} className="min-w-0 flex-1" />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {STATUS_META[item.status].label}
                    {item.lastMessageAt ? ` · ${formatRelative(item.lastMessageAt, timezone, now)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
