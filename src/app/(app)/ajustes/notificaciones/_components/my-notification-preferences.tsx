import { getMyNotificationPreferences } from "@/data/notification-settings";
import type { Actor } from "@/lib/permissions";
import { MyPreferencesForm } from "./my-preferences-form";

/**
 * «Tus avisos»: how the signed-in person hears about each event that reaches their role ([USU-18]). Self-contained
 * (loads its own data) so «Mi cuenta» can show it too for every role.
 */
export async function MyNotificationPreferences({ actor }: { actor: Actor }) {
  const { preferences, events } = await getMyNotificationPreferences(actor);
  const mine = events.filter((event) => event.reachesMe).map((event) => event.key);
  // The key restarts the form when the events that reach this person change (after saving «Qué avisa y a quién»).
  return (
    <MyPreferencesForm
      key={mine.join(",")}
      events={mine}
      preferences={Object.fromEntries(mine.map((key) => [key, preferences[key]]))}
    />
  );
}
