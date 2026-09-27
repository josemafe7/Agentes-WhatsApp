import { CopyCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listDuplicateSuggestions } from "@/data/contacts-merge";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { DuplicatePairs } from "../_components/duplicate-suggestions";
import { CONTACTS_PATH, DUPLICATES_PATH } from "../_lib/search-params";

export const metadata: Metadata = { title: "Posibles duplicados" };

/**
 * Posibles duplicados ([CTO-04]): contacts with the same email, the same phone or the same full name. The app never
 * merges them on its own; each pair opens the merge ([CTO-05]). Propietario, Administrador and Supervisor.
 */
export default async function DuplicatesPage() {
  const actor = await requirePageActor({ next: DUPLICATES_PATH });
  if (!can(actor, PERMISSIONS.contacts.merge)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const suggestions = await listDuplicateSuggestions(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Contactos", href: CONTACTS_PATH }, { label: "Posibles duplicados" }]}
        title="Posibles duplicados"
        description="Contactos con el mismo email, el mismo teléfono o el mismo nombre completo. La app nunca los fusiona sola: revisa cada pareja y decide."
      />
      {suggestions.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={CopyCheck}
            title="No hay posibles duplicados"
            description="Cuando dos contactos compartan email, teléfono o nombre completo, aparecerán aquí."
            action={
              <Button asChild variant="outline">
                <Link href={CONTACTS_PATH}>Ir a Contactos</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <DuplicatePairs suggestions={suggestions} />
      )}
    </div>
  );
}
