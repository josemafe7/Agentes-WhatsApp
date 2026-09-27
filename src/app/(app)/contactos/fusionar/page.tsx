import { Lock, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getAgendaSettings } from "@/data/agenda-config";
import { previewContactMerge, type MergePreview } from "@/data/contacts-merge";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { AuthError, ValidationError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { CONTACTS_PATH, DUPLICATES_PATH, mergePath, mergeQueryFromSearchParams } from "../_lib/search-params";
import { bookingWords } from "../[id]/_bookings/presentation";
import { MergeForm } from "./_components/merge-form";

export const metadata: Metadata = { title: "Fusionar contactos" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const backToContacts = (
  <Button asChild variant="outline">
    <Link href={CONTACTS_PATH}>Ir a Contactos</Link>
  </Button>
);

/**
 * Fusionar contactos ([CTO-05]): which contact stays, which data of each, what moves (identities, conversations —
 * joined when they share a web chat, WhatsApp or Telegram channel —, bookings, consents, labels and fields) and the
 * confirmation. Propietario, Administrador and Supervisor; the server checks it again on merging.
 */
export default async function MergePage({ searchParams }: PageProps) {
  const query = mergeQueryFromSearchParams(await searchParams);
  const actor = await requirePageActor({ next: query ? mergePath(query.one, query.other) : CONTACTS_PATH });
  if (!can(actor, PERMISSIONS.contacts.merge)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Contactos", href: CONTACTS_PATH }, { label: "Posibles duplicados", href: DUPLICATES_PATH }, { label: "Fusionar" }]}
      title="Fusionar contactos"
      description="Elige qué contacto se queda y qué datos conserva. Todo lo del otro pasa a él y el otro desaparece."
    />
  );
  if (!query) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={Users} title="Elige dos contactos" description="Selecciona dos contactos en la lista, o revisa una pareja de «Posibles duplicados»." action={backToContacts} />
      </div>
    );
  }

  let previews: [MergePreview, MergePreview];
  try {
    previews = await Promise.all([
      previewContactMerge(actor, { keepId: query.one, mergeId: query.other }),
      previewContactMerge(actor, { keepId: query.other, mergeId: query.one }),
    ]);
  } catch (error) {
    if (!(error instanceof AuthError) && !(error instanceof ValidationError)) throw error;
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={Lock} title="No se pueden fusionar estos contactos" description="Puede que alguno ya no exista o que hayas elegido el mismo dos veces." action={backToContacts} />
      </div>
    );
  }
  const [{ timezone }, agenda] = await Promise.all([getBusinessProfile(actor), getAgendaSettings(actor)]);
  // The older contact stays unless the person picks the other one.
  const [first, second] = previews;
  const defaultKeepId = first.keep.createdAt <= first.merge.createdAt ? first.keep.id : second.keep.id;
  return (
    <div className="space-y-6">
      {header}
      <MergeForm previews={previews} defaultKeepId={defaultKeepId} timezone={timezone} bookingsLabel={bookingWords(agenda.terminology).title} />
    </div>
  );
}
