"use client";
// Ajustes › Recordatorios ([AGD-24], [AGD-32]): the switch, up to three reminders (each its own card) and the
// «¡Gracias!» of «Confirmo». The server checks everything again; what it refuses comes back next to its field.
import { LoaderCircle, Plus } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReminderOptions, ReminderSettingsView } from "@/data/reminder-settings";
import type { ActionResult } from "@/lib/action-result";
import { MAX_REMINDER_RULES, type ReminderRule } from "@/lib/reminder-rules";
import { saveReminderSettingsAction } from "../actions";
import { buildRulesPayload, newRule } from "../_lib/reminder-form";
import { ReminderRuleCard } from "./reminder-rule-card";

type ReminderSettingsFormProps = {
  settings: ReminderSettingsView;
  options: ReminderOptions;
  words: { booking: string; bookings: string; customers: string };
};

const errorList = (messages?: string[]) => messages?.map((message) => ({ message }));

export function ReminderSettingsForm({ settings, options, words }: ReminderSettingsFormProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, unknown>(saveReminderSettingsAction, undefined);
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [rules, setRules] = useState<ReminderRule[]>(settings.rules.length ? settings.rules : [newRule([], crypto.randomUUID())]);
  const [thanksText, setThanksText] = useState(settings.thanksText ?? "");
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function templateVariables(rule: ReminderRule): readonly string[] {
    const number = options.whatsapp.find((item) => item.channelId === rule.whatsapp?.channelId);
    return number?.templates.find((item) => item.name === rule.whatsapp?.templateName && item.language === rule.whatsapp?.templateLanguage)?.variables ?? [];
  }

  function save() {
    const payload = { enabled, rules: buildRulesPayload(rules, templateVariables), thanksText: thanksText.trim() || null };
    startTransition(() => formAction(payload));
  }

  return (
    <div className="max-w-[720px] space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
        <div className="grid gap-1">
          <Label htmlFor="reminders-enabled">Enviar recordatorios</Label>
          <p id="reminders-enabled-help" className="text-sm text-muted-foreground">
            {enabled
              ? `Cada ${words.booking} pendiente o confirmada recibe cada recordatorio una vez; si cambia de hora, se calculan de nuevo.`
              : "Desactivados: no se envía ninguno."}
          </p>
        </div>
        <Switch id="reminders-enabled" checked={enabled} onCheckedChange={setEnabled} aria-describedby="reminders-enabled-help" />
      </div>

      {rules.map((rule, index) => (
        <ReminderRuleCard
          key={rule.id}
          index={index}
          rule={rule}
          options={options}
          errors={errors}
          onChange={(next) => setRules((current) => current.map((item, at) => (at === index ? next : item)))}
          onRemove={rules.length > 1 ? () => setRules((current) => current.filter((_, at) => at !== index)) : null}
        />
      ))}
      <FieldError errors={errorList(errors?.rules)} />
      {rules.length < MAX_REMINDER_RULES ? (
        <Button type="button" variant="outline" onClick={() => setRules((current) => [...current, newRule(current, crypto.randomUUID())])}>
          <Plus aria-hidden />
          Añadir recordatorio
        </Button>
      ) : null}

      <div className="grid gap-2 rounded-xl border p-4">
        <Label htmlFor="reminders-thanks">Respuesta a «Confirmo»</Label>
        <Input id="reminders-thanks" value={thanksText} maxLength={300} placeholder={options.defaults.thanksText} onChange={(event) => setThanksText(event.target.value)} />
        <p className="text-sm text-muted-foreground">
          Cuando el cliente pulsa «Confirmo», su {words.booking} queda «Confirmada por el cliente» y recibe este texto una vez. Por WhatsApp, Meta lo cobra como un
          mensaje de servicio.
        </p>
      </div>

      <FormMessage result={state} />
      <Button type="button" onClick={save} disabled={pending} aria-busy={pending}>
        {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
        Guardar recordatorios
      </Button>
    </div>
  );
}
