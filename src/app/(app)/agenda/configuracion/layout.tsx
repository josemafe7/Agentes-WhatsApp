import { Eye } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { ConfigTabs, type ConfigTab } from "./_components/config-tabs";
import { AGENDA_CONFIG_PATH, AGENDA_PATH, RESOURCES_PATH, SERVICES_PATH } from "./_lib/paths";

export const metadata: Metadata = { title: "Configuración de la agenda" };

/**
 * Agenda › Configuración ([AGD-20]): General, Servicios and Recursos for owner and admin; the supervisor only opens
 * Recursos to add and remove absences (docs/pantallas.md «Quién ve qué»). Each page checks its own permission again:
 * the layout is not the security boundary ([SEG-04]).
 */
export default async function AgendaConfigLayout({ children }: { children: ReactNode }) {
  const actor = await requirePageActor({ next: AGENDA_CONFIG_PATH });
  const canConfigure = can(actor, PERMISSIONS.agenda.configure);
  if (!canConfigure && !can(actor, PERMISSIONS.agenda.block)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  const resourcesTab: ConfigTab = { key: "recursos", label: "Recursos", href: RESOURCES_PATH };
  const tabs: ConfigTab[] = canConfigure
    ? [{ key: "general", label: "General", href: AGENDA_CONFIG_PATH, exact: true }, { key: "servicios", label: "Servicios", href: SERVICES_PATH }, resourcesTab]
    : [resourcesTab];

  return (
    <div className="flex flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Agenda", href: AGENDA_PATH }, { label: "Configuración" }]}
        title="Configuración de la agenda"
        description={canConfigure ? "Qué se reserva, quién lo hace, cuándo y cómo se avisa al cliente." : "Las ausencias de cada recurso."}
        actions={
          canConfigure ? null : (
            <Badge variant="outline" className="h-[22px] gap-1">
              <Eye aria-hidden />
              Solo ausencias
            </Badge>
          )
        }
      />
      <ConfigTabs tabs={tabs} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
