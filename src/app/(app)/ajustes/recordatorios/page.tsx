import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getAgendaSettings } from "@/data/agenda-config";
import { getReminderSettings } from "@/data/reminder-settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { TERMINOLOGY_OPTIONS } from "@/lib/sectors/schema";
import { requirePageActor } from "@/server/session";
import { ReminderSettingsForm } from "./_components/reminder-settings-form";

export const metadata: Metadata = { title: "Recordatorios" };

/**
 * Ajustes › Recordatorios ([AGD-24], [AGD-25], [AGD-32]): up to three reminders before each booking, off by default,
 * each by its channels in order (WhatsApp with an approved utility template, Telegram, email) with its message, and the
 * «¡Gracias!» of «Confirmo». Owner and admin.
 */
export default async function ReminderSettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/recordatorios" });
  if (!can(actor, PERMISSIONS.agenda.configure)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const [{ settings, options }, agenda] = await Promise.all([getReminderSettings(actor), getAgendaSettings(actor)]);
  const words = agenda.terminology;
  const customers = TERMINOLOGY_OPTIONS.customer.find((option) => option.singular === words.customer)?.plural ?? "clientes";

  return (
    <>
      <PageHeader
        title="Recordatorios"
        description={`Hasta tres avisos a cada ${words.customer} antes de su ${words.booking}. Nunca a las ${words.bookings} canceladas ni por un canal del que se ha dado de baja.`}
      />
      <ReminderSettingsForm settings={settings} options={options} words={{ booking: words.booking, bookings: words.bookings, customers }} />
    </>
  );
}
