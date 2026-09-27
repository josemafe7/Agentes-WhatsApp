"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LeaveGuard } from "@/app/(app)/agentes/[id]/_components/leave-guard";
import { UnsavedChangesBar } from "@/app/(app)/agentes/[id]/_components/editor-form";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { OffHoursBehavior, ReplyMode } from "@/lib/enums";
import { saveChannelSettingsAction } from "../../../actions";
import { OFF_HOURS_OPTIONS, REPLY_MODE_OPTIONS } from "../../../_lib/labels";
import { splitLines } from "../../../_lib/webchat";

export type ChannelSettingsValues = {
  name: string;
  replyMode: ReplyMode;
  disclosureMessage: string;
  offHoursBehavior: OffHoursBehavior;
  testMode: boolean;
  /** One contact per line. */
  testAllowlist: string;
};

type ChannelSettingsFormProps = {
  channelId: string;
  initial: ChannelSettingsValues;
  /** The notice used when this channel has none of its own (Ajustes › Privacidad y legal). */
  defaultNotice: string;
  /** What to write in the test list for this type of channel. */
  allowlistHelp: string;
};

type Failure = { error: string; fieldErrors?: Record<string, string[]> };

function toInput(values: ChannelSettingsValues) {
  return {
    name: values.name,
    replyMode: values.replyMode,
    disclosureMessage: values.disclosureMessage,
    offHoursBehavior: values.offHoursBehavior,
    testMode: values.testMode,
    testAllowlist: splitLines(values.testAllowlist),
  };
}

/**
 * Configuración ([CAN-06], [CAN-07], [CAN-08], [CUM-01]): name, reply mode, the AI notice of the first message,
 * off-hours behaviour and test mode with its list. Saves with the bar «Cambios sin guardar» (DESIGN.md).
 */
export function ChannelSettingsForm({ channelId, initial, defaultNotice, allowlistHelp }: ChannelSettingsFormProps) {
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const errorsFor = (field: string) => failure?.fieldErrors?.[field]?.map((message) => ({ message }));
  const set = <K extends keyof ChannelSettingsValues>(key: K, value: ChannelSettingsValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  function save() {
    if (pending || !dirty) return;
    startTransition(async () => {
      const result = await saveChannelSettingsAction(channelId, toInput(values));
      if (!result.ok) {
        setFailure({ error: result.error, fieldErrors: result.fieldErrors });
        return;
      }
      setFailure(null);
      setSaved(values);
      toast.success(result.message ?? "Cambios guardados.");
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="grid max-w-2xl gap-6"
    >
      <FieldGroup>
        <Field data-invalid={errorsFor("name") ? true : undefined}>
          <FieldLabel htmlFor="channel-name">Nombre</FieldLabel>
          <Input
            id="channel-name"
            value={values.name}
            maxLength={80}
            onChange={(event) => set("name", event.target.value)}
            aria-invalid={errorsFor("name") ? true : undefined}
            aria-describedby="channel-name-help"
          />
          <FieldDescription id="channel-name-help">Para tu equipo: se ve en Canales y en la bandeja.</FieldDescription>
          <FieldError errors={errorsFor("name")} />
        </Field>

        <FieldSet data-invalid={errorsFor("replyMode") ? true : undefined}>
          <FieldLegend variant="label">Modo de respuesta</FieldLegend>
          <RadioGroup
            value={values.replyMode}
            onValueChange={(value) => {
              const option = REPLY_MODE_OPTIONS.find((candidate) => candidate.value === value);
              if (option) set("replyMode", option.value);
            }}
            className="grid gap-3"
          >
            {REPLY_MODE_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
                <RadioGroupItem id={`reply-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`reply-${option.value}-help`} />
                <div className="grid gap-1">
                  <FieldLabel htmlFor={`reply-${option.value}`}>{option.label}</FieldLabel>
                  <FieldDescription id={`reply-${option.value}-help`}>{option.description}</FieldDescription>
                </div>
              </div>
            ))}
          </RadioGroup>
          <FieldError errors={errorsFor("replyMode")} />
        </FieldSet>

        <Field data-invalid={errorsFor("disclosureMessage") ? true : undefined}>
          <FieldLabel htmlFor="channel-notice">Aviso de IA del primer mensaje (opcional)</FieldLabel>
          <Textarea
            id="channel-notice"
            rows={2}
            value={values.disclosureMessage}
            maxLength={1_000}
            placeholder={defaultNotice}
            onChange={(event) => set("disclosureMessage", event.target.value)}
            aria-invalid={errorsFor("disclosureMessage") ? true : undefined}
            aria-describedby="channel-notice-help"
          />
          <FieldDescription id="channel-notice-help">
            Va delante de la primera respuesta de la IA en cada conversación. Vacío: el aviso por defecto de Ajustes › Privacidad y legal.
          </FieldDescription>
          <FieldError errors={errorsFor("disclosureMessage")} />
        </Field>

        <FieldSet data-invalid={errorsFor("offHoursBehavior") ? true : undefined}>
          <FieldLegend variant="label">Fuera de horario</FieldLegend>
          <RadioGroup
            value={values.offHoursBehavior}
            onValueChange={(value) => {
              const option = OFF_HOURS_OPTIONS.find((candidate) => candidate.value === value);
              if (option) set("offHoursBehavior", option.value);
            }}
            className="grid gap-3"
          >
            {OFF_HOURS_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
                <RadioGroupItem id={`offhours-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`offhours-${option.value}-help`} />
                <div className="grid gap-1">
                  <FieldLabel htmlFor={`offhours-${option.value}`}>{option.label}</FieldLabel>
                  <FieldDescription id={`offhours-${option.value}-help`}>{option.description}</FieldDescription>
                </div>
              </div>
            ))}
          </RadioGroup>
          <FieldError errors={errorsFor("offHoursBehavior")} />
        </FieldSet>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="channel-test-mode">Modo pruebas</FieldLabel>
            <FieldDescription>
              {values.testMode ? "La IA solo contesta a los contactos de la lista; los demás mensajes esperan a una persona." : "La IA contesta a todos los contactos."}
            </FieldDescription>
          </FieldContent>
          <Switch id="channel-test-mode" checked={values.testMode} onCheckedChange={(checked) => set("testMode", checked)} />
        </Field>

        {values.testMode ? (
          <Field data-invalid={errorsFor("testAllowlist") ? true : undefined}>
            <FieldLabel htmlFor="channel-allowlist">Solo a estos contactos</FieldLabel>
            <Textarea
              id="channel-allowlist"
              rows={4}
              value={values.testAllowlist}
              onChange={(event) => set("testAllowlist", event.target.value)}
              spellCheck={false}
              className="font-mono"
              aria-invalid={errorsFor("testAllowlist") ? true : undefined}
              aria-describedby="channel-allowlist-help"
            />
            <FieldDescription id="channel-allowlist-help">{allowlistHelp}</FieldDescription>
            <FieldError errors={errorsFor("testAllowlist")} />
          </Field>
        ) : null}
      </FieldGroup>
      <UnsavedChangesBar
        dirty={dirty}
        pending={pending}
        error={failure?.error}
        onDiscard={() => {
          setValues(saved);
          setFailure(null);
        }}
      />
      <LeaveGuard dirty={dirty && !pending} />
    </form>
  );
}
