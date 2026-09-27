import { ChevronLeft, ChevronRight, SearchX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listInboxChannels } from "@/data/channels";
import { listContactLabels, listContacts } from "@/data/contacts";
import { getBusinessProfile } from "@/data/settings";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { can, channelFilter, PERMISSIONS } from "@/lib/permissions";
import { ValidationError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { ContactsFilters } from "./_components/contacts-filters";
import { ContactsTable, type ContactRow } from "./_components/contacts-table";
import { NewContactDialog } from "./_components/new-contact-dialog";
import { CONTACTS_PATH, contactsHref, contactsQueryFromSearchParams } from "./_lib/search-params";
import { contactDisplayName } from "./_lib/view";

export const metadata: Metadata = { title: "Contactos" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type ContactsPage = Awaited<ReturnType<typeof listContacts>>;

/**
 * Contactos ([CTO-01]): search, filters by channel and label, the channels of each contact, its last conversation
 * and pages of 25. An Agent only sees the contacts with a conversation in their channels ([PER-02]).
 */
export default async function ContactsListPage({ searchParams }: PageProps) {
  const actor = await requirePageActor({ next: CONTACTS_PATH });
  if (!can(actor, PERMISSIONS.contacts.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const { query, filter } = contactsQueryFromSearchParams(await searchParams);
  const [channels, labels, profile] = await Promise.all([listInboxChannels(actor), listContactLabels(actor), getBusinessProfile(actor)]);

  let page: ContactsPage | null = null;
  try {
    page = await listContacts(actor, filter);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }

  // A contact created by hand has no conversation yet: an Agent limited to some channels would not see it
  // afterwards, so the button is only for those who see every contact.
  const canCreate = can(actor, PERMISSIONS.contacts.edit) && channelFilter(actor) === null;
  const newContact = canCreate ? <NewContactDialog /> : null;
  const hasFilters = Object.keys(query).length > 0;
  const clearFilters = (
    <Button asChild variant="outline">
      <Link href={CONTACTS_PATH}>Quitar filtros</Link>
    </Button>
  );

  const header = (
    <>
      <PageHeader title="Contactos" description="Las personas que escriben al negocio, con sus datos y su historial." actions={newContact} />
      <ContactsFilters key={JSON.stringify(query)} query={query} channels={channels} labels={labels} />
    </>
  );

  if (!page) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState title="Algún filtro no es válido" description="Revisa la búsqueda o quita los filtros." retry={clearFilters} />
      </div>
    );
  }

  const now = new Date();
  const rows: ContactRow[] = page.items.map((item) => ({
    id: item.id,
    displayName: contactDisplayName(item),
    hasName: Boolean(item.name?.trim()),
    phone: item.phone,
    email: item.email,
    labels: item.labels,
    channelTypes: item.channelTypes,
    lastConversation: item.lastConversationAt
      ? { relative: formatRelative(item.lastConversationAt, profile.timezone, now), full: formatDateTime(item.lastConversationAt, profile.timezone) }
      : null,
  }));

  return (
    <div className="space-y-6">
      {header}
      {rows.length === 0 ? (
        <div className="rounded-xl border">
          {hasFilters ? (
            <EmptyState icon={SearchX} title="Nada coincide con estos filtros" action={clearFilters} />
          ) : (
            <EmptyState
              icon={Users}
              title="Aún no hay contactos"
              description="Se crean solos cuando alguien escribe por un canal."
              action={newContact ?? undefined}
            />
          )}
        </div>
      ) : (
        <>
          <ContactsTable rows={rows} />
          <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground tabular-nums">
              {formatNumber(page.total)} {page.total === 1 ? "contacto" : "contactos"} · Página {page.page} de {page.pageCount}
            </p>
            <div className="flex gap-2">
              {page.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={contactsHref(query, page.page - 1)}>
                    <ChevronLeft aria-hidden />
                    Anterior
                  </Link>
                </Button>
              ) : null}
              {page.page < page.pageCount ? (
                <Button asChild variant="outline">
                  <Link href={contactsHref(query, page.page + 1)}>
                    Siguiente
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
