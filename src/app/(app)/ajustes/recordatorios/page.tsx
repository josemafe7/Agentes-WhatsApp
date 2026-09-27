import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getAgendaSettings, getReminderSettings } from "@/data/agenda-config";
import { can, PERMISSIONS } from "@/lib/permissions";
import { TERMINOLOGY_OPTIONS } from "@/lib/sectors/schema";
import { defaultReminderEmail } from "@/server/booking/reminder-fields";
import { requirePageActor } from "@/server/session";
import { ReminderSettingsForm } from "./_components/reminder-settings-form";

export const metadata: Metadata = { title: "Recordatorios" };

/**
 * Ajustes › Recordatorios ([AGD-24], [AGD-25]): a reminder before each booking, off by default, by WhatsApp with an
 * approved utility template (its variables mapped to booking data) or by email with an editable text. Owner and admin.
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
        description={`Un aviso a cada ${words.customer} antes de su ${words.booking}, una sola vez. Nunca a las ${words.bookings} canceladas ni a quien se ha dado de baja.`}
      />
      <ReminderSettingsForm settings={settings} options={options} defaultEmail={defaultReminderEmail(words.booking)} words={{ booking: words.booking, customers }} />
    </>
  );
}
