"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ChannelPreference, NotificationEvent } from "@/data/notification-settings";
import type { ActionResult } from "@/lib/action-result";
import { saveMyNotificationPreferencesAction } from "../actions";
import { EVENT_LABELS } from "../_lib/labels";

type Preferences = Partial<Record<NotificationEvent, ChannelPreference>>;

const CHANNELS: { key: keyof ChannelPreference; label: string }[] = [
  { key: "inApp", label: "En la app" },
  { key: "push", label: "Push" },
  { key: "email", label: "Email" },
];

/** The signed-in person's channels for each event that reaches them ([USU-18], [PWA-07]). */
export function MyPreferencesForm({ events, preferences }: { events: NotificationEvent[]; preferences: Preferences }) {
  const [state, formAction] = useActionState<ActionResult | undefined, Preferences>(saveMyNotificationPreferencesAction, undefined);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Preferences>(preferences);

  function toggle(event: NotificationEvent, channel: keyof ChannelPreference, checked: boolean) {
    setValues((current) => {
      const previous = current[event] ?? { inApp: true, push: true, email: false };
      return { ...current, [event]: { ...previous, [channel]: checked } };
    });
  }

  function save() {
    const changes = Object.fromEntries(events.map((event) => [event, values[event]])) as Preferences;
    startTransition(() => formAction(changes));
  }

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Ahora mismo el negocio no envía ningún aviso a tu rol.</p>;
  }

  return (
    <div className="max-w-[640px] space-y-4">
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <caption className="sr-only">Por dónde te llega cada aviso</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">
                Aviso
              </th>
              {CHANNELS.map((channel) => (
                <th key={channel.key} scope="col" className="w-20 px-2 py-2 text-center font-medium">
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((event) => (
              <tr key={event}>
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {EVENT_LABELS[event].label}
                </th>
                {CHANNELS.map((channel) => (
                  <td key={channel.key} className="px-2 py-2 text-center">
                    <Checkbox
                      className="mx-auto"
                      checked={values[event]?.[channel.key] ?? false}
                      onCheckedChange={(checked) => toggle(event, channel.key, checked === true)}
                      aria-label={`${EVENT_LABELS[event].label}: ${channel.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Push llega a los dispositivos donde actives los avisos. El email solo sale si el correo del sistema está configurado.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" variant="outline" onClick={save} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar mis avisos"}
        </Button>
        <FormMessage result={state} />
      </div>
    </div>
  );
}
