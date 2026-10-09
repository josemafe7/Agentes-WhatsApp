"use client";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_NAME_MAX } from "@/lib/agent-input";
import { AGENT_LANGUAGES } from "../../_lib/labels";
import { EditorForm } from "./editor-form";
import { useAgentSection } from "./use-agent-section";

export type GeneralValues = { name: string; description: string; language: string; tone: string };

/**
 * General ([AGE-03]): name, description, language and tone. The avatar has its own form (it saves on upload).
 * `internal`: the agent answers the team ([INT-01]), so the help texts speak of the team and not of customers.
 */
export function GeneralForm({ agentId, initial, internal = false }: { agentId: string; initial: GeneralValues; internal?: boolean }) {
  const section = useAgentSection(agentId, initial, (values) => ({ ...values }));
  const { values, set, errorsFor } = section;
  const nameErrors = errorsFor("name");
  const descriptionErrors = errorsFor("description");
  const languageErrors = errorsFor("language");
  const toneErrors = errorsFor("tone");

  return (
    <EditorForm section={section}>
      <FieldGroup>
        <Field data-invalid={nameErrors ? true : undefined}>
          <FieldLabel htmlFor="agent-name">Nombre</FieldLabel>
          <Input
            id="agent-name"
            value={values.name}
            maxLength={AGENT_NAME_MAX}
            onChange={(event) => set("name", event.target.value)}
            aria-invalid={nameErrors ? true : undefined}
            aria-describedby="agent-name-help"
          />
          <FieldDescription id="agent-name-help">
            {internal ? "Es el nombre con el que lo ve tu equipo en «Asistentes»." : "Es el nombre con el que se presenta a los clientes."}
          </FieldDescription>
          <FieldError errors={nameErrors?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={descriptionErrors ? true : undefined}>
          <FieldLabel htmlFor="agent-description">Descripción (opcional)</FieldLabel>
          <Textarea
            id="agent-description"
            rows={2}
            value={values.description}
            maxLength={300}
            onChange={(event) => set("description", event.target.value)}
            aria-invalid={descriptionErrors ? true : undefined}
            aria-describedby="agent-description-help"
          />
          <FieldDescription id="agent-description-help">
            {internal
              ? "La ve tu equipo en «Asistentes»: cuenta para qué sirve."
              : "Para tu equipo: se ve en la lista de agentes, no la leen los clientes."}
          </FieldDescription>
          <FieldError errors={descriptionErrors?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={languageErrors ? true : undefined}>
          <FieldLabel htmlFor="agent-language">Idioma</FieldLabel>
          <Select value={values.language} onValueChange={(value) => set("language", value)}>
            <SelectTrigger id="agent-language" className="w-full sm:w-64" aria-invalid={languageErrors ? true : undefined} aria-describedby="agent-language-help">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_LANGUAGES.map((language) => (
                <SelectItem key={language.value} value={language.value}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription id="agent-language-help">
            {internal ? "Si alguien le escribe en otro idioma, le contesta en el suyo." : "Si el cliente escribe en otro idioma, le contesta en el suyo."}
          </FieldDescription>
          <FieldError errors={languageErrors?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={toneErrors ? true : undefined}>
          <FieldLabel htmlFor="agent-tone">Tono (opcional)</FieldLabel>
          <Input
            id="agent-tone"
            value={values.tone}
            maxLength={80}
            placeholder="Cercano y profesional"
            onChange={(event) => set("tone", event.target.value)}
            aria-invalid={toneErrors ? true : undefined}
          />
          <FieldError errors={toneErrors?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>
    </EditorForm>
  );
}
