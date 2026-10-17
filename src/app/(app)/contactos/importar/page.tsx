import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { DEFAULT_PHONE_PREFIX } from "@/lib/contact-import";
import { requirePageActor } from "@/server/session";
import { importMaxBytes } from "../_lib/import-upload";
import { CONTACTS_PATH, IMPORT_PATH } from "../_lib/search-params";
import { ContactImportForm } from "./_components/contact-import-form";

export const metadata: Metadata = { title: "Importar contactos" };

/**
 * Importar contactos ([CTO-11]–[CTO-13]): an Excel or a CSV, checked first and imported after. Propietario and
 * Administrador.
 */
export default async function ImportContactsPage() {
  const actor = await requirePageActor({ next: IMPORT_PATH });
  if (!can(actor, PERMISSIONS.contacts.import)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Contactos", href: CONTACTS_PATH }, { label: "Importar" }]}
        title="Importar contactos"
        description="Trae tus clientes de un Excel o un CSV. Los que ya están (mismo email o teléfono) se saltan y nunca se cambian, así que importar dos veces el mismo archivo no crea nada."
      />
      <ContactImportForm maxMegabytes={Math.round(importMaxBytes() / 1024 / 1024)} defaultPrefix={`+${DEFAULT_PHONE_PREFIX}`} />
    </div>
  );
}
