import { toPushDeviceView } from "@/components/pwa/device-label";
import { PushSettings } from "@/components/pwa/push-settings";
import { getMyNotificationPreferences } from "@/data/notification-settings";
import { getBusinessProfile } from "@/data/settings";
import type { Actor } from "@/lib/permissions";
import { listMyPushDevices } from "@/server/notifications/push";
import { MyPreferencesForm } from "./my-preferences-form";

/**
 * «Tus avisos»: how the signed-in person hears about each event that reaches their role ([USU-18]) and push on their
 * devices ([PWA-03]). Self-contained (loads its own data) so «Mi cuenta» can show it too for every role.
 */
export async function MyNotificationPreferences({ actor }: { actor: Actor }) {
  const [{ preferences, events }, devices, { timezone }] = await Promise.all([
    getMyNotificationPreferences(actor),
    listMyPushDevices(actor),
    getBusinessProfile(actor),
  ]);
  const mine = events.filter((event) => event.reachesMe).map((event) => event.key);
  const now = new Date();
  return (
    <div className="space-y-8">
      {/* The key restarts the form when the events that reach this person change (after saving «Qué avisa y a quién»). */}
      <MyPreferencesForm
        key={mine.join(",")}
        events={mine}
        preferences={Object.fromEntries(mine.map((key) => [key, preferences[key]]))}
      />
      <PushSettings devices={devices.map((device) => toPushDeviceView(device, timezone, now))} />
    </div>
  );
}
