"use client";

import { FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { AgentKnowledgeMode } from "@/lib/enums";
import { KNOWLEDGE_MODE_OPTIONS } from "../../_lib/labels";
import { EditorForm } from "./editor-form";
import { useAgentSection } from "./use-agent-section";

type KnowledgeValues = { knowledgeMode: AgentKnowledgeMode };

/** Conocimiento ([AGE-07]): «Automático» (searches when needed) or «Buscar siempre» (before every reply). */
export function KnowledgeForm({ agentId, initial }: { agentId: string; initial: KnowledgeValues }) {
  const section = useAgentSection(agentId, initial, (values) => ({ ...values }));
  const errors = section.errorsFor("knowledgeMode");

  return (
    <EditorForm section={section}>
      <FieldSet data-invalid={errors ? true : undefined}>
        <FieldLegend variant="label">Cuándo busca en el conocimiento</FieldLegend>
        <RadioGroup
          value={section.values.knowledgeMode}
          onValueChange={(value) => {
            const option = KNOWLEDGE_MODE_OPTIONS.find((candidate) => candidate.value === value);
            if (option) section.set("knowledgeMode", option.value);
          }}
          className="grid gap-3"
        >
          {KNOWLEDGE_MODE_OPTIONS.map((option) => (
            <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
              <RadioGroupItem id={`knowledge-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`knowledge-${option.value}-help`} />
              <div className="grid gap-1">
                <FieldLabel htmlFor={`knowledge-${option.value}`}>{option.label}</FieldLabel>
                <FieldDescription id={`knowledge-${option.value}-help`}>{option.description}</FieldDescription>
              </div>
            </div>
          ))}
        </RadioGroup>
        {errors ? (
          <p role="alert" className="text-sm text-destructive-text">
            {errors[0]}
          </p>
        ) : null}
      </FieldSet>
    </EditorForm>
  );
}
