import { Eye, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getContact, listContactLabels, type ContactDetail } from "@/data/contacts";
import { listDuplicateSuggestions } from "@/data/contacts-merge";
import { getBusinessProfile } from "@/data/settings";
import { formatDateTime } from "@/lib/format";
import { can, PERMISSIONS } from "@/lib/permissions";
import { AuthError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { ContactDataActions } from "../_components/contact-data-actions";
import { ContactDetailsForm } from "../_components/contact-details-form";
import {
  ConsentsSection,
  ContactSection,
  ConversationsSection,
  IdentitiesSection,
  OptOutNotice,
  ReadOnlyCustomFields,
  ReadOnlyDetails,
  ReadOnlyLabels,
} from "../_components/contact-sections";
import { CustomFieldsEditor } from "../_components/custom-fields-editor";
import { DuplicatesOf } from "../_components/duplicate-suggestions";
import { LabelsEditor } from "../_components/labels-editor";
import { CONTACTS_PATH, contactPath } from "../_lib/search-params";
import { activeOptOuts, contactDisplayName } from "../_lib/view";
import { ContactBookingsSection } from "./_bookings/contact-bookings-section";

export const metadata: Metadata = { title: "Ficha del contacto" };

type ContactPageProps = { params: Promise<{ id: string }> };

/**
 * Ficha del contacto ([CTO-02]): data, identities, labels, custom fields, appointments, consents and the conversation
 * history. Editable for whoever may edit it; an Agent only reaches contacts of their channels ([PER-02]). Its bajas
 * with «Levantar baja» ([CTO-08]) and its possible duplicates ([CTO-04]) for whoever may merge; «Exportar datos» and
 * «Borrar contacto» for whoever may export and erase ([CTO-06], [CTO-07]).
 */
export default async function ContactPage({ params }: ContactPageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: contactPath(encodeURIComponent(id)) });
  if (!can(actor, PERMISSIONS.contacts.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  let contact: ContactDetail;
  try {
    contact = await getContact(actor, id);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // Unknown and out-of-scope contacts look the same: nobody learns whether it exists.
    return (
      <EmptyState
        icon={Lock}
        title="No puedes ver este contacto"
        description="Puede que no exista o que no sea de tus canales."
        action={
          <Button asChild variant="outline">
            <Link href={CONTACTS_PATH}>Ir a Contactos</Link>
          </Button>
        }
      />
    );
  }

  const canEdit = can(actor, PERMISSIONS.contacts.edit, { channelIds: contact.conversations.map((conversation) => conversation.channel.id) });
  const canMerge = can(actor, PERMISSIONS.contacts.merge);
  const canExport = can(actor, PERMISSIONS.contacts.export);
  const canErase = can(actor, PERMISSIONS.contacts.delete);
  const [profile, labelSuggestions, duplicates] = await Promise.all([
    getBusinessProfile(actor),
    canEdit ? listContactLabels(actor) : Promise.resolve([]),
    canMerge ? listDuplicateSuggestions(actor, { contactId: contact.id }) : Promise.resolve([]),
  ]);
  const name = contactDisplayName(contact);
  const readOnlyBadge = canEdit ? null : (
    <Badge variant="outline" className="h-[22px] gap-1">
      <Eye aria-hidden />
      Solo lectura
    </Badge>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Contactos", href: CONTACTS_PATH }, { label: name }]}
        title={name}
        description={`Contacto desde el ${formatDateTime(contact.createdAt, profile.timezone, { preset: "date" })}`}
        actions={
          readOnlyBadge || canExport || canErase ? (
            <>
              {readOnlyBadge}
              <ContactDataActions contactId={contact.id} displayName={name} canExport={canExport} canErase={canErase} />
            </>
          ) : null
        }
      />
      <div className="grid gap-6">
        <OptOutNotice optOuts={activeOptOuts(contact.consents)} timezone={profile.timezone} liftFor={canMerge ? { contactId: contact.id } : undefined} />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 gap-6">
            <ContactSection title="Datos">
              {canEdit ? (
                <ContactDetailsForm
                  contactId={contact.id}
                  initial={{ name: contact.name ?? "", phone: contact.phone ?? "", email: contact.email ?? "", notes: contact.notes ?? "" }}
                />
              ) : (
                <ReadOnlyDetails contact={contact} />
              )}
            </ContactSection>
            <ContactSection title="Etiquetas">
              {canEdit ? <LabelsEditor contactId={contact.id} labels={contact.labels} suggestions={labelSuggestions} /> : <ReadOnlyLabels labels={contact.labels} />}
            </ContactSection>
            <ContactSection title="Campos personalizados">
              {canEdit ? <CustomFieldsEditor contactId={contact.id} fields={contact.customFields} /> : <ReadOnlyCustomFields fields={contact.customFields} />}
            </ContactSection>
            <ConversationsSection conversations={contact.conversations} timezone={profile.timezone} />
          </div>
          <div className="grid min-w-0 gap-6">
            <IdentitiesSection identities={contact.identities} />
            {duplicates.length > 0 ? (
              <ContactSection title="Posibles duplicados" description="Pueden ser la misma persona. La app nunca los fusiona sola.">
                <DuplicatesOf contactId={contact.id} suggestions={duplicates} />
              </ContactSection>
            ) : null}
            <ContactBookingsSection actor={actor} contactId={contact.id} contactName={name} />
            <ConsentsSection consents={contact.consents} timezone={profile.timezone} />
          </div>
        </div>
      </div>
    </div>
  );
}
