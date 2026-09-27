import { BellRing, ChevronRight, Clock, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { getAgendaSettings, getReminderSettings, listResources, listServices } from "@/data/agenda-config";
import { can, PERMISSIONS } from "@/lib/permissions";
import { SLOT_INTERVALS, TERMINOLOGY_OPTIONS } from "@/lib/sectors/schema";
import { requirePageActor } from "@/server/session";
import { reminderSummary } from "../../ajustes/recordatorios/_lib/reminder-form";
import { AgendaSettingsForm } from "./_components/agenda-settings-form";
import { formatMinutes } from "./servicios/_lib/service-form";
import { AGENDA_CONFIG_PATH, BUSINESS_HOURS_PATH, REMINDERS_PATH, RESOURCES_PATH, SERVICES_PATH } from "./_lib/paths";

/** A singular that is one of the options, or the first option (words saved before the options existed). */
function chosen(options: readonly { singular: string }[], value: string): string {
  return options.some((option) => option.singular === value) ? value : options[0].singular;
}

/**
 * Agenda › Configuración › General ([AGD-01], [AGD-05], [AGD-06], [AGD-08], [AGD-20]): mode, slot step and words; the
 * business hours and holidays (Ajustes › Horario) and the reminders (Ajustes › Recordatorios) are one click away.
 */
export default async function AgendaConfigPage() {
  const actor = await requirePageActor({ next: AGENDA_CONFIG_PATH });
  if (!can(actor, PERMISSIONS.agenda.configure)) {
    // The supervisor manages the resources' absences only.
    if (can(actor, PERMISSIONS.agenda.block)) redirect(RESOURCES_PATH);
    return <NoPermission description={noPermissionDescription(actor.role)} />;
  }
  const [settings, reminders, services, resources] = await Promise.all([
    getAgendaSettings(actor),
    getReminderSettings(actor),
    listServices(actor, { activeOnly: true }),
    listResources(actor),
  ]);
  const missing = [services.length === 0 ? "un servicio" : null, resources.length === 0 ? "un recurso" : null].filter(Boolean);

  return (
    <div className="space-y-8">
      {missing.length > 0 ? (
        <p className="max-w-[640px] rounded-xl border bg-info-soft p-4 text-sm text-info">
          Para que haya huecos, añade al menos {missing.join(" y ")} en{" "}
          <Link href={services.length === 0 ? SERVICES_PATH : RESOURCES_PATH} className="font-medium underline underline-offset-4">
            {services.length === 0 ? "Servicios" : "Recursos"}
          </Link>
          .
        </p>
      ) : null}

      <section aria-labelledby="agenda-mode-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="agenda-mode-heading" className="text-lg font-semibold">
            Cómo se reserva
          </h2>
          <p className="text-sm text-muted-foreground">
            La antelación mínima y máxima, la duración y las personas se ponen en cada{" "}
            <Link href={SERVICES_PATH} className="text-primary-text underline underline-offset-4">
              servicio
            </Link>
            .
          </p>
        </div>
        <AgendaSettingsForm
          initial={{
            agendaMode: settings.mode,
            slotIntervalMin: settings.slotIntervalMin,
            words: {
              booking: chosen(TERMINOLOGY_OPTIONS.booking, settings.terminology.booking),
              resource: chosen(TERMINOLOGY_OPTIONS.resource, settings.terminology.resource),
              customer: chosen(TERMINOLOGY_OPTIONS.customer, settings.terminology.customer),
            },
          }}
          slotIntervals={SLOT_INTERVALS}
          wordOptions={TERMINOLOGY_OPTIONS}
        />
      </section>

      {settings.mode === "capacity" && services.length > 0 ? (
        <section aria-labelledby="agenda-groups-heading" className="max-w-[640px] space-y-3">
          <h2 id="agenda-groups-heading" className="text-lg font-semibold">
            Duración de la mesa y tamaño del grupo
          </h2>
          <ul className="divide-y rounded-xl border">
            {services.map((service) => (
              <li key={service.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="font-medium">{service.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatMinutes(service.durationMin)} · de {service.minPeople} a {service.maxPeople} personas
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">Se cambian en cada servicio.</p>
        </section>
      ) : null}

      <section aria-label="Horario y avisos" className="grid max-w-[640px] gap-3">
        <LinkCard
          icon={Clock}
          href={BUSINESS_HOURS_PATH}
          title="Horario y festivos"
          description="Los del negocio mandan: nunca hay huecos fuera de ese horario ni en festivos, aunque un recurso tenga horario."
        />
        <LinkCard icon={BellRing} href={REMINDERS_PATH} title="Recordatorios" description={reminderSummary(reminders.settings)} />
      </section>
    </div>
  );
}

function LinkCard({ icon: Icon, href, title, description }: { icon: LucideIcon; href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
