// Read parts of the contact's card ([CTO-02], [CTO-08], [CTO-09]): identities, conversation history, permissions,
// consents and bajas, and the
// read-only view of the data for Solo lectura (the bookings are in ../[id]/_bookings). Server components: only data the
// server already checked with getContact (src/data/contacts.ts) reaches them.
import { BellOff, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContactDetail } from "@/data/contacts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHANNEL_KIND_LABELS, CONSENT_METHOD_LABELS, hasPermission, PERMISSION_LABELS, type ConsentState } from "@/lib/consents";
import { LiftOptOutButton, OptOutRequestButton, PermissionButton } from "../[id]/_consents/consent-dialogs";
import { CONSENT_TYPE_LABELS, consentSourceLabel, CONVERSATION_STATUS_VIEW, identityPhone, type ActiveOptOut } from "../_lib/view";
import { ChannelName } from "./channel-icons";
import { LabelBadges } from "./label-badges";

/** The inbox conversation (docs/pantallas.md «Conversación · /bandeja/[id]»). */
const conversationHref = (conversationId: string) => `/bandeja/${conversationId}`;

export function ContactSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          <h2>{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * A baja is always visible on the card while it lasts ([CTO-08], [CUM-03], [CUM-04]), by kind of channel: of everything,
 * or only of novedades y publicidad. With `liftFor`, whoever may lift it gets «Levantar baja» on each one.
 */
export function OptOutNotice({ optOuts, timezone, liftFor }: { optOuts: ActiveOptOut[]; timezone: string; liftFor?: { contactId: string } }) {
  if (optOuts.length === 0) return null;
  return (
    <Alert className="border-warning/40 bg-warning-soft text-warning">
      <BellOff aria-hidden />
      <AlertTitle>Dado de baja</AlertTitle>
      <AlertDescription className="text-foreground">
        <ul className="grid gap-1">
          {optOuts.map((optOut) => (
            <li key={`${optOut.kind}:${optOut.scope}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {optOut.scope === "all" ? "Está dado de baja en este canal" : "Está dado de baja de novedades y publicidad"}:{" "}
                {CHANNEL_KIND_LABELS[optOut.kind]}, desde el {formatDateTime(optOut.since, timezone, { preset: "date" })}.
              </span>
              {liftFor ? <LiftOptOutButton contactId={liftFor.contactId} kind={optOut.kind} scope={optOut.scope} /> : null}
            </li>
          ))}
        </ul>
        <p className="mt-1">
          Una baja de todo para la IA, los recordatorios, las plantillas y los envíos por ese canal; una de novedades y publicidad, solo lo de
          marketing. Si vuelve a escribir, su mensaje llega a la bandeja para una persona.
        </p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Permisos ([CTO-09]): «Avisos de sus citas» (WhatsApp and Telegram reminders, «Sí, por defecto» until the customer
 * says no, decision 0030) and «Novedades y publicidad», each with since when, how it was given or withdrawn and who
 * recorded it; with the AI, what was said ([HER-15]). With `editFor`, «Marcar» and «Quitar».
 */
export function PermissionsSection({ state, timezone, editFor }: { state: ConsentState; timezone: string; editFor?: { contactId: string } }) {
  return (
    <ContactSection
      title="Permisos"
      description="Avisos de sus citas se da por hecho mientras no diga que no, y vale para WhatsApp y Telegram (el correo no lo necesita); Novedades y publicidad, solo si lo da, para todos los canales."
    >
      <ul className="grid gap-4">
        {(["reminders", "marketing"] as const).map((permission) => {
          const record = state.permissions[permission];
          const granted = hasPermission(state, permission);
          return (
            <li key={permission} className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{PERMISSION_LABELS[permission]}</span>
                <span className={cn("text-xs font-medium", granted ? "text-success" : "text-muted-foreground")}>{granted ? (record ? "Sí" : "Sí, por defecto") : "No"}</span>
              </div>
              {record ? (
                <span className="text-xs text-muted-foreground">
                  {granted ? "Lo dio" : "Lo retiró"} el {formatDateTime(record.givenAt ?? record.createdAt, timezone, { preset: "date" })}
                  {record.method ? ` · ${CONSENT_METHOD_LABELS[record.method]}` : ""}
                  {record.recordedByName ? ` · Anotado por ${record.recordedByName}` : record.source === "ai" ? " · Anotado por la IA" : ""}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{granted ? "Se da por hecho mientras no diga que no." : "Sin anotar."}</span>
              )}
              {record?.note ? <span className="text-xs text-muted-foreground">Nota: {record.note}</span> : null}
              {record?.evidence ? <EvidenceLines evidence={record.evidence} /> : null}
              {editFor ? (
                <div className="mt-1">
                  <PermissionButton contactId={editFor.contactId} permission={permission} granted={!granted} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editFor ? (
        <div className="mt-4 border-t pt-4">
          <OptOutRequestButton contactId={editFor.contactId} />
        </div>
      ) : null}
    </ContactSection>
  );
}

function EvidenceLines({ evidence }: { evidence: { question: string; answer: string } }) {
  return (
    <span className="grid gap-0.5 text-xs text-muted-foreground">
      <span>Pregunta: «{evidence.question}»</span>
      <span>Respuesta: «{evidence.answer}»</span>
    </span>
  );
}

/** Identidades: channel type and identifier ([CTO-03]); the phone is only data, never how we recognise them ([CAN-13]). */
export function IdentitiesSection({ identities }: { identities: ContactDetail["identities"] }) {
  return (
    <ContactSection title="Identidades" description="Cómo le reconoce cada canal. El teléfono es solo un dato: nunca sirve para identificarle.">
      {identities.length === 0 ? (
        <Muted>Todavía no ha escrito por ningún canal.</Muted>
      ) : (
        <ul className="grid gap-4">
          {identities.map((identity) => {
            const { icon: Icon, iconClassName, label } = CHANNEL_IDENTITY[identity.channelType];
            const phone = identityPhone(identity.phone);
            return (
              <li key={identity.id} className="grid gap-1 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon aria-hidden className={cn("size-4 shrink-0", iconClassName)} />
                  {label}
                </span>
                <span className="font-mono text-xs break-all">{identity.externalId}</span>
                {identity.displayName ? <span className="text-xs text-muted-foreground">Nombre en el canal: {identity.displayName}</span> : null}
                {phone ? <span className="text-xs text-muted-foreground tabular-nums">Teléfono: {phone}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </ContactSection>
  );
}

/** Historial de conversaciones: each one opens in the inbox. An Agent only sees those of their channels ([PER-02]). */
export function ConversationsSection({ conversations, timezone }: { conversations: ContactDetail["conversations"]; timezone: string }) {
  const now = new Date();
  return (
    <ContactSection title="Conversaciones">
      {conversations.length === 0 ? (
        <Muted>Todavía no hay conversaciones con este contacto.</Muted>
      ) : (
        <ul className="-mx-2 grid">
          {conversations.map((conversation) => {
            const status = CONVERSATION_STATUS_VIEW[conversation.status];
            const StatusIcon = status.icon;
            return (
              <li key={conversation.id}>
                <Link
                  href={conversationHref(conversation.id)}
                  className="flex min-h-10 items-center gap-3 rounded-lg px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-12"
                >
                  <span className="min-w-0 flex-1">
                    <ChannelName type={conversation.channel.type} name={conversation.channel.name} />
                  </span>
                  <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium", status.className)}>
                    <StatusIcon aria-hidden className="size-3" />
                    {status.label}
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">
                    {conversation.lastMessageAt ? (
                      <time title={formatDateTime(conversation.lastMessageAt, timezone)}>{formatRelative(conversation.lastMessageAt, timezone, now)}</time>
                    ) : (
                      "—"
                    )}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="sr-only">Abrir la conversación</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ContactSection>
  );
}

/** Consentimientos: every permission, baja and alta with when, where, how and who ([CTO-02], [CTO-08], [CUM-13]). */
export function ConsentsSection({ consents, timezone }: { consents: ContactDetail["consents"]; timezone: string }) {
  return (
    <ContactSection title="Consentimientos y bajas">
      {consents.length === 0 ? (
        <Muted>No hay consentimientos ni bajas anotados.</Muted>
      ) : (
        <ul className="grid gap-3">
          {consents.map((consent) => {
            const where = consent.channelName ?? (consent.kind && consent.type !== "legal_acceptance" ? CHANNEL_KIND_LABELS[consent.kind] : null);
            return (
              <li key={consent.id} className="grid gap-0.5 text-sm">
                <span className="font-medium">
                  {CONSENT_TYPE_LABELS[consent.type]}
                  {where ? <span className="font-normal text-muted-foreground"> · {where}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(consent.createdAt, timezone)} · {consentSourceLabel(consent.source)}
                  {consent.method ? ` · ${CONSENT_METHOD_LABELS[consent.method]}` : ""}
                  {consent.recordedByName ? ` · Anotado por ${consent.recordedByName}` : ""}
                </span>
                {consent.givenAt ? (
                  <span className="text-xs text-muted-foreground">Lo dio el {formatDateTime(consent.givenAt, timezone, { preset: "date" })}</span>
                ) : null}
                {consent.note ? <span className="text-xs text-muted-foreground">Nota: {consent.note}</span> : null}
                {consent.evidence ? <EvidenceLines evidence={consent.evidence} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </ContactSection>
  );
}

type ReadOnlyItem = { label: string; value: ReactNode };

function ReadOnlyList({ items }: { items: ReadOnlyItem[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="grid min-w-0 gap-1">
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="text-sm break-words whitespace-pre-wrap">{item.value === null || item.value === "" ? "—" : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Solo lectura: the data, labels and fields as lists, without buttons (DESIGN.md «Sin permiso»). */
export function ReadOnlyDetails({ contact }: { contact: Pick<ContactDetail, "name" | "phone" | "email" | "notes"> }) {
  return (
    <ReadOnlyList
      items={[
        { label: "Nombre", value: contact.name },
        { label: "Teléfono", value: contact.phone },
        { label: "Email", value: contact.email },
        { label: "Notas", value: contact.notes },
      ]}
    />
  );
}

export function ReadOnlyLabels({ labels }: { labels: string[] }) {
  if (labels.length === 0) return <Muted>Sin etiquetas.</Muted>;
  return <LabelBadges labels={labels} max={labels.length} />;
}

export function ReadOnlyCustomFields({ fields }: { fields: Record<string, string> }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return <Muted>Sin campos.</Muted>;
  return <ReadOnlyList items={entries.map(([label, value]) => ({ label, value }))} />;
}
