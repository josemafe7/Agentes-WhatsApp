"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HANDOFF_MESSAGE_MAX, UNKNOWN_THRESHOLD_RANGE } from "@/lib/agent-input";
import { linesToList } from "../../_lib/lines";
import { EditorForm } from "./editor-form";
import { useAgentSection, type AgentSection } from "./use-agent-section";

export type HandoffValues = {
  keywords: string;
  unknownThreshold: string;
  sensitiveTopics: string;
  messageInHours: string;
  messageOffHours: string;
  notifyUserIds: string[];
};

export type NotifyOption = { id: string; name: string; roleLabel: string };

function toInput(values: HandoffValues): Record<string, unknown> {
  const threshold = values.unknownThreshold.trim();
  const parsed = Number(threshold);
  return {
    handoff: {
      keywords: linesToList(values.keywords),
      sensitiveTopics: linesToList(values.sensitiveTopics),
      // Text that is not a number goes as is: the server explains the error next to the field.
      ...(threshold ? { unknownThreshold: Number.isFinite(parsed) ? parsed : threshold } : {}),
      messageInHours: values.messageInHours,
      messageOffHours: values.messageOffHours,
      notifyUserIds: values.notifyUserIds,
    },
  };
}

type HandoffFormProps = {
  agentId: string;
  initial: HandoffValues;
  people: NotifyOption[];
  defaultMessages: { messageInHours: string; messageOffHours: string };
};

/** Traspaso ([AGE-09], [TRA-01], [TRA-03]): when the agent hands over, what the customer reads and who is told. */
export function HandoffForm({ agentId, initial, people, defaultMessages }: HandoffFormProps) {
  const section = useAgentSection(agentId, initial, toInput);
  const { values, set } = section;

  return (
    <EditorForm section={section}>
      <FieldGroup>
        <TextListField
          section={section}
          field="keywords"
          label="Palabras clave"
          help="Una por línea. Si el cliente las escribe, la conversación pasa a una persona. Mejor frases («hablar con una persona») que palabras sueltas."
        />
        <Field data-invalid={section.errorsFor("handoff.unknownThreshold") ? true : undefined}>
          <FieldLabel htmlFor="handoff-unknown">Número de «no lo sé» (opcional)</FieldLabel>
          <Input
            id="handoff-unknown"
            inputMode="numeric"
            className="w-24"
            value={values.unknownThreshold}
            onChange={(event) => set("unknownThreshold", event.target.value)}
            aria-invalid={section.errorsFor("handoff.unknownThreshold") ? true : undefined}
            aria-describedby="handoff-unknown-help"
          />
          <FieldDescription id="handoff-unknown-help">
            Cuántas veces puede decir que no sabe algo antes de pasar la conversación a una persona (de {UNKNOWN_THRESHOLD_RANGE.min} a{" "}
            {UNKNOWN_THRESHOLD_RANGE.max}).
          </FieldDescription>
          <FieldError errors={section.errorsFor("handoff.unknownThreshold")?.map((message) => ({ message }))} />
        </Field>
        <TextListField
          section={section}
          field="sensitiveTopics"
          label="Temas sensibles (opcional)"
          help="Uno por línea. Si salen en la conversación, la pasa a una persona en vez de responder."
        />
        <MessageField section={section} field="messageInHours" label="Mensaje al cliente dentro de horario" fallback={defaultMessages.messageInHours} />
        <MessageField section={section} field="messageOffHours" label="Mensaje al cliente fuera de horario" fallback={defaultMessages.messageOffHours} />
        <FieldSet data-invalid={section.errorsFor("handoff.notifyUserIds") ? true : undefined}>
          <FieldLegend variant="label">A quién avisar (opcional)</FieldLegend>
          <FieldDescription>Si no eliges a nadie, se avisa a quien diga Ajustes › Notificaciones.</FieldDescription>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay personas en el equipo.</p>
          ) : (
            <ul className="grid gap-2">
              {people.map((person) => {
                const id = `notify-${person.id}`;
                const checked = values.notifyUserIds.includes(person.id);
                return (
                  <li key={person.id} className="flex items-center gap-3">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(next) =>
                        set("notifyUserIds", next === true ? [...values.notifyUserIds, person.id] : values.notifyUserIds.filter((userId) => userId !== person.id))
                      }
                    />
                    <label htmlFor={id} className="text-sm">
                      {person.name} <span className="text-muted-foreground">· {person.roleLabel}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <FieldError errors={section.errorsFor("handoff.notifyUserIds")?.map((message) => ({ message }))} />
        </FieldSet>
      </FieldGroup>
    </EditorForm>
  );
}

type SectionProps = { section: AgentSection<HandoffValues> };

function TextListField({ section, field, label, help }: SectionProps & { field: "keywords" | "sensitiveTopics"; label: string; help: string }) {
  const errors = section.errorsFor(`handoff.${field}`);
  const id = `handoff-${field}`;
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={4}
        value={section.values[field]}
        onChange={(event) => section.set(field, event.target.value)}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${id}-help`}
      />
      <FieldDescription id={`${id}-help`}>{help}</FieldDescription>
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}

function MessageField({ section, field, label, fallback }: SectionProps & { field: "messageInHours" | "messageOffHours"; label: string; fallback: string }) {
  const errors = section.errorsFor(`handoff.${field}`);
  const id = `handoff-${field}`;
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={2}
        maxLength={HANDOFF_MESSAGE_MAX}
        value={section.values[field]}
        placeholder={fallback}
        onChange={(event) => section.set(field, event.target.value)}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${id}-help`}
      />
      <FieldDescription id={`${id}-help`}>Vacío, se envía el que ves de ejemplo.</FieldDescription>
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}
