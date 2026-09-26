"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EventSetting, NotificationAudience, NotificationEvent } from "@/data/notification-settings";
import type { ActionResult } from "@/lib/action-result";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/permissions";
import { saveNotificationSettingsAction } from "../actions";
import { EVENT_LABELS } from "../_lib/labels";

type EventRow = { key: NotificationEvent; audience: NotificationAudience; setting: EventSetting };

type Payload = { events: Partial<Record<NotificationEvent, EventSetting>> };

/** Which events notify and which roles by default ([AJU-08]). Each person then picks the channels. */
export function BusinessNotificationsForm({ events }: { events: EventRow[] }) {
  const [state, formAction] = useActionState<ActionResult | undefined, Payload>(saveNotificationSettingsAction, undefined);
  const [pending, startTransition] = useTransition();
  const [settings, setSettings] = useState(() => Object.fromEntries(events.map((event) => [event.key, event.setting])) as Record<NotificationEvent, EventSetting>);

  function setEnabled(key: NotificationEvent, enabled: boolean) {
    setSettings((current) => ({ ...current, [key]: { ...current[key], enabled } }));
  }

  function toggleRole(key: NotificationEvent, role: Role, checked: boolean) {
    setSettings((current) => {
      const roles = checked ? [...current[key].roles, role] : current[key].roles.filter((value) => value !== role);
      return { ...current, [key]: { ...current[key], roles: ROLES.filter((value) => roles.includes(value)) } };
    });
  }

  function save() {
    startTransition(() => formAction({ events: settings }));
  }

  return (
    <div className="max-w-[640px] space-y-4">
      <ul className="divide-y rounded-xl border">
        {events.map(({ key, audience }) => {
          const setting = settings[key];
          const errors = state && !state.ok ? state.fieldErrors?.[key] : undefined;
          return (
            <li key={key} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor={`event-${key}`}>{EVENT_LABELS[key].label}</Label>
                  <p className="text-sm text-muted-foreground">{EVENT_LABELS[key].description}</p>
                </div>
                <Switch id={`event-${key}`} checked={setting.enabled} onCheckedChange={(checked) => setEnabled(key, checked)} />
              </div>
              {audience === "roles" && setting.enabled ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">A quién avisa</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {ROLES.map((role) => (
                      <div key={role} className="flex items-center gap-2">
                        <Checkbox
                          id={`event-${key}-${role}`}
                          checked={setting.roles.includes(role)}
                          onCheckedChange={(checked) => toggleRole(key, role, checked === true)}
                          aria-invalid={errors ? true : undefined}
                        />
                        <Label htmlFor={`event-${key}-${role}`} className="font-normal">
                          {ROLE_LABELS[role]}
                        </Label>
                      </div>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <FieldError errors={errors?.map((message) => ({ message }))} />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <FormMessage result={state} />
      </div>
    </div>
  );
}
