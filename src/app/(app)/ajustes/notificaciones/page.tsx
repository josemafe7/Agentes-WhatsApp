import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getNotificationSettings, NOTIFICATION_EVENT_DEFINITIONS, NOTIFICATION_EVENTS } from "@/data/notification-settings";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { BusinessNotificationsForm } from "./_components/business-notifications-form";
import { MyNotificationPreferences } from "./_components/my-notification-preferences";

export const metadata: Metadata = { title: "Notificaciones" };

/** Ajustes › Notificaciones ([AJU-08]): what notifies and who by default, plus your own channels. Owner and admin. */
export default async function NotificationSettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/notificaciones" });
  if (!can(actor, PERMISSIONS.settings.business)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const settings = await getNotificationSettings(actor);

  return (
    <div className="space-y-8">
      <PageHeader title="Notificaciones" description="Qué sucesos avisan al equipo y a quién. Cada persona elige después por dónde le llegan." />

      <section aria-labelledby="business-notifications-heading" className="space-y-4">
        <h2 id="business-notifications-heading" className="text-lg font-semibold">
          Qué avisa y a quién
        </h2>
        <BusinessNotificationsForm
          events={NOTIFICATION_EVENTS.map((key) => ({
            key,
            audience: NOTIFICATION_EVENT_DEFINITIONS[key].audience,
            setting: settings[key],
          }))}
        />
      </section>

      <section aria-labelledby="my-notifications-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="my-notifications-heading" className="text-lg font-semibold">
            Tus avisos
          </h2>
          <p className="text-sm text-muted-foreground">Por dónde te llega a ti cada aviso. Solo se ven los que el negocio envía a tu rol.</p>
        </div>
        <MyNotificationPreferences actor={actor} />
      </section>
    </div>
  );
}
