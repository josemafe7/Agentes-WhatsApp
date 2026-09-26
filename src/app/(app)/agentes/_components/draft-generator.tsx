"use client";

import { KeyRound, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type KeyboardEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { OPENROUTER_KEY_HREF } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ActionFailure } from "@/lib/action-result";
import { generateAgentDraftAction, type AgentDraftView } from "../actions";
import { DRAFT_DESCRIPTION_MAX } from "../_lib/requests";

type DraftSource = "url" | "description";

type DraftGeneratorProps = {
  /** The agent being edited (the cost is linked to it); absent in «Nuevo agente». */
  agentId?: string;
  /** Web of the business (Ajustes › Negocio), proposed as the address. */
  defaultUrl?: string | null;
  /** There is an OpenRouter key; without it nothing can be generated and the notice says why ([ARR-14]). */
  aiConfigured: boolean;
  onDraft: (draft: AgentDraftView) => void;
  idPrefix?: string;
};

/**
 * «Generar borrador con IA» ([AGE-05], [ASI-08]): from the business web or a description. The draft only fills the
 * form; nothing is saved until the person saves. Not a <form>: it also lives inside the editor's form.
 */
export function DraftGenerator({ agentId, defaultUrl, aiConfigured, onDraft, idPrefix = "draft" }: DraftGeneratorProps) {
  const [source, setSource] = useState<DraftSource>(defaultUrl ? "url" : "description");
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [description, setDescription] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldErrors = failure?.fieldErrors?.[source];

  function generate() {
    if (pending || !aiConfigured) return;
    startTransition(async () => {
      const result = await generateAgentDraftAction(source === "url" ? { source, url, agentId } : { source, description, agentId });
      if (!result.ok) return setFailure(result);
      setFailure(null);
      if (result.data) onDraft(result.data);
    });
  }

  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    generate();
  }

  return (
    <div className="grid gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={source}
        onValueChange={(value) => {
          if (value === "url" || value === "description") {
            setSource(value);
            setFailure(null);
          }
        }}
        aria-label="De dónde sale el borrador"
        className="w-full sm:w-auto"
      >
        <ToggleGroupItem value="url" className="flex-1 sm:flex-none">
          Desde la web
        </ToggleGroupItem>
        <ToggleGroupItem value="description" className="flex-1 sm:flex-none">
          Desde una descripción
        </ToggleGroupItem>
      </ToggleGroup>

      {source === "url" ? (
        <Field data-invalid={fieldErrors ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-url`}>Web del negocio</FieldLabel>
          <Input
            id={`${idPrefix}-url`}
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://www.tunegocio.es"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={onEnter}
            aria-invalid={fieldErrors ? true : undefined}
            aria-describedby={`${idPrefix}-url-help`}
          />
          <FieldDescription id={`${idPrefix}-url-help`}>La IA lee la página y propone las instrucciones. Si no se puede leer, te lo dice.</FieldDescription>
          <FieldError errors={fieldErrors?.map((message) => ({ message }))} />
        </Field>
      ) : (
        <Field data-invalid={fieldErrors ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-description`}>Describe tu negocio</FieldLabel>
          <Textarea
            id={`${idPrefix}-description`}
            rows={4}
            value={description}
            maxLength={DRAFT_DESCRIPTION_MAX}
            placeholder="Qué hacéis, a quién atendéis, qué suelen preguntar los clientes y qué no debe hacer el agente."
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={fieldErrors ? true : undefined}
          />
          <FieldError errors={fieldErrors?.map((message) => ({ message }))} />
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={generate} disabled={pending || !aiConfigured} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden className="text-ai" />}
          {pending ? "Generando…" : "Generar borrador"}
        </Button>
        {failure && !fieldErrors ? <FormMessage result={failure} /> : null}
      </div>
      {aiConfigured ? null : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <span className="font-medium text-foreground">Añade tu clave de OpenRouter</span> para generar borradores con IA.{" "}
            <Link href={OPENROUTER_KEY_HREF} className="text-primary-text underline-offset-4 hover:underline">
              Ir a Ajustes › IA
            </Link>
          </span>
        </p>
      )}
    </div>
  );
}
