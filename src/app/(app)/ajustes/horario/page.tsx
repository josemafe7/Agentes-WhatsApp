import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getBusinessProfileSettings } from "@/data/business";
import { getBusinessHours, listClosures, MAX_RANGES_PER_DAY, WEEKDAY_NAMES, WEEKDAYS } from "@/data/business-hours";
import { formatDateTime } from "@/lib/format";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { ClosuresSection } from "./_components/closures-section";
import { WeeklyHoursEditor } from "./_components/weekly-hours-editor";

export const metadata: Metadata = { title: "Horario" };

const DAYS = WEEKDAYS.map((weekday) => ({
  weekday,
  label: WEEKDAY_NAMES[weekday].charAt(0).toUpperCase() + WEEKDAY_NAMES[weekday].slice(1),
}));

/** A local calendar date "YYYY-MM-DD" as «12 oct 2026» (no time zone shift: it is already local). */
function formatLocalDate(date: string): string {
  return formatDateTime(new Date(`${date}T12:00:00Z`), "UTC", { preset: "date" });
}

/** Ajustes › Horario ([AJU-03]): weekly hours with several ranges per day, holidays and closures. Owner and admin. */
export default async function HoursSettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/horario" });
  if (!can(actor, PERMISSIONS.settings.business)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const [hours, closures, profile] = await Promise.all([getBusinessHours(actor), listClosures(actor), getBusinessProfileSettings(actor)]);
  const today = formatDateTime(new Date(), profile.timezone, { pattern: "yyyy-MM-dd" });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Horario"
        description="Marca cuándo está abierto el negocio. Fuera de este horario la agenda no ofrece citas y los canales pueden responder distinto."
      />

      <section aria-labelledby="week-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="week-heading" className="text-lg font-semibold">
            Horario semanal
          </h2>
          <p className="text-sm text-muted-foreground">
            Horas en la zona horaria del negocio ({profile.timezone.replaceAll("_", " ")}), que se cambia en{" "}
            <Link href="/ajustes/negocio" className="text-primary-text underline underline-offset-4">
              Negocio
            </Link>
            .
          </p>
        </div>
        <WeeklyHoursEditor days={DAYS} initialRanges={hours} maxRangesPerDay={MAX_RANGES_PER_DAY} />
      </section>

      <section aria-labelledby="closures-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="closures-heading" className="text-lg font-semibold">
            Festivos y cierres
          </h2>
          <p className="text-sm text-muted-foreground">Días en que el negocio no abre, aunque el horario semanal diga otra cosa.</p>
        </div>
        <ClosuresSection
          closures={closures.map((closure) => ({
            id: closure.id,
            reason: closure.reason,
            label:
              closure.startDate === closure.endDate
                ? formatLocalDate(closure.startDate)
                : `${formatLocalDate(closure.startDate)} – ${formatLocalDate(closure.endDate)}`,
            past: closure.endDate < today,
          }))}
        />
      </section>
    </div>
  );
}
