"use client";

import { ChevronRight, Globe, LoaderCircle, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition, type KeyboardEvent } from "react";
import { INSTRUCTION_FIELDS } from "@/app/(app)/agentes/_lib/labels";
import { DRAFT_DESCRIPTION_MAX, DRAFT_DESCRIPTION_MIN } from "@/app/(app)/agentes/_lib/requests";
import { FormMessage } from "@/components/form-message";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentStepData, SetupAgentDraft } from "@/data/setup-agent";
import type { AgentInstructions } from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import { AGENT_NAME_MAX, FREE_TEXT_MAX, INSTRUCTION_MAX } from "@/lib/agent-input";
import type { Faq } from "@/lib/sectors";
import type { SetupFormState } from "../actions";
import { FieldErrors, fieldErrorsOf } from "../_components/field-errors";
import { StepFooter } from "../_components/step-footer";
import { SubmitButton } from "../_components/submit-button";
import { generateAgentDraftAction, saveAgentStepAction } from "./agent-actions";

const TONE_MAX = 80;
const URL_MAX = 2_000;
/** Same limits as faqSchema (src/lib/sectors/schema.ts), checked again on the server. */
const FAQ_QUESTION_MAX = 300;
const FAQ_ANSWER_MAX = 2_000;

/** A proposed FAQ being edited; `key` keeps each row (and its focus) while its text changes. */
type EditableFaq = Faq & { key: string };

/** Keys are the same on the server and in the browser (no hydration mismatch); each draft gets new ones. */
function editableFaqs(faqs: readonly Faq[], batch: number): EditableFaq[] {
  return faqs.map((faq, index) => ({ ...faq, key: `${batch}-${index}` }));
}

type InstructionKey = keyof AgentInstructions;
type DraftSource = "url" | "description";

type AgentFormProps = {
  data: AgentStepData;
  /** «Saltar este paso»: skipStepAction bound to step 5 by the server component. */
  skipAction: (previous: SetupFormState, formData: FormData) => Promise<ActionResult>;
  /** Step 4 (AI): «Atrás», and where to add the OpenRouter key. */
  aiStepHref: string;
};

function instructionValues(instructions: AgentInstructions): Record<InstructionKey, string> {
  return Object.fromEntries(INSTRUCTION_FIELDS.map(({ key }) => [key, instructions[key] ?? ""])) as Record<InstructionKey, string>;
}

/**
 * Step 5 ([ASI-08]): the first agent from the sector template (name, tone and instructions editable), optionally
 * rewritten by «Generar desde la web del negocio» (with an OpenRouter key), or «Saltar este paso».
 */
export function AgentForm({ data, skipAction, aiStepHref }: AgentFormProps) {
  const [state, formAction, pending] = useActionState(saveAgentStepAction, undefined);
  const [skipState, skipFormAction, skipping] = useActionState(skipAction, undefined);
  const [name, setName] = useState(data.values.name);
  const [tone, setTone] = useState(data.values.tone);
  const [instructions, setInstructions] = useState(() => instructionValues(data.values.instructions));
  const [faqs, setFaqs] = useState<EditableFaq[]>(() => editableFaqs(data.values.faqs, 0));
  const [draftCount, setDraftCount] = useState(0);
  const hasInstructionErrors = INSTRUCTION_FIELDS.some(({ key }) => fieldErrorsOf(state, `instructions.${key}`).length > 0);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const errors = { name: fieldErrorsOf(state, "name"), tone: fieldErrorsOf(state, "tone"), faqs: fieldErrorsOf(state, "faqs") };

  const updateFaq = (key: string, change: Partial<Faq>) =>
    setFaqs((current) => current.map((faq) => (faq.key === key ? { ...faq, ...change } : faq)));

  const applyDraft = (draft: SetupAgentDraft) => {
    setName(draft.name);
    setTone(draft.tone);
    setInstructions((current) => ({ ...current, ...draft.instructions }));
    setFaqs(editableFaqs(draft.faqs, draftCount + 1));
    setDraftCount((count) => count + 1);
    setInstructionsOpen(true);
  };

  return (
    <form action={formAction} className="space-y-6">
      <div className="rounded-xl border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Plantilla de {data.sectorLabel}</p>
        <p className="text-muted-foreground">
          {data.template.description} Viene con instrucciones, reglas para pasar la conversación a una persona y el modelo de IA
          elegido en el paso anterior. Podrás cambiarlo todo cuando quieras en Agentes.
        </p>
      </div>

      <FieldGroup className="max-w-[640px]">
        <Field data-invalid={errors.name.length > 0 || undefined}>
          <FieldLabel htmlFor="agent-name">Nombre del agente</FieldLabel>
          <Input
            id="agent-name"
            name="name"
            required
            maxLength={AGENT_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name.length > 0 || undefined}
            aria-describedby={errors.name.length > 0 ? "agent-name-error" : undefined}
          />
          <FieldErrors id="agent-name-error" messages={errors.name} />
        </Field>
        <Field data-invalid={errors.tone.length > 0 || undefined}>
          <FieldLabel htmlFor="agent-tone">Tono (opcional)</FieldLabel>
          <Input
            id="agent-tone"
            name="tone"
            maxLength={TONE_MAX}
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            aria-invalid={errors.tone.length > 0 || undefined}
            aria-describedby={errors.tone.length > 0 ? "agent-tone-help agent-tone-error" : "agent-tone-help"}
          />
          <FieldDescription id="agent-tone-help">Cómo habla con tus clientes, por ejemplo «Cercano y alegre».</FieldDescription>
          <FieldErrors id="agent-tone-error" messages={errors.tone} />
        </Field>
      </FieldGroup>

      {data.aiConfigured ? (
        <DraftPanel website={data.website} onDraft={applyDraft} />
      ) : (
        <div className="max-w-[640px] space-y-1 rounded-xl border p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Sparkles aria-hidden className="size-4 text-ai" />
            Generar desde la web del negocio
          </p>
          <p className="text-muted-foreground">
            La IA puede leer tu web y proponerte las instrucciones del agente, pero necesita la clave de OpenRouter. Añádela en
            el paso 4 o sigue con la plantilla: podrás cambiar las instrucciones cuando quieras en Agentes.
          </p>
          <Button asChild variant="link" className="h-auto px-0">
            <Link href={aiStepHref}>Añadir la clave en el paso 4</Link>
          </Button>
        </div>
      )}

      <details
        open={instructionsOpen || hasInstructionErrors}
        onToggle={(event) => setInstructionsOpen(event.currentTarget.open)}
        className="group max-w-[640px] rounded-xl border"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          Instrucciones del agente
          <span className="font-normal text-muted-foreground">· opcional revisarlas ahora</span>
        </summary>
        <FieldGroup className="border-t p-4">
          {INSTRUCTION_FIELDS.map(({ key, label, help }) => {
            const messages = fieldErrorsOf(state, `instructions.${key}`);
            const id = `agent-instructions-${key}`;
            return (
              <Field key={key} data-invalid={messages.length > 0 || undefined}>
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                <Textarea
                  id={id}
                  name={`instructions.${key}`}
                  rows={3}
                  maxLength={key === "freeText" ? FREE_TEXT_MAX : INSTRUCTION_MAX}
                  value={instructions[key]}
                  onChange={(event) => setInstructions((current) => ({ ...current, [key]: event.target.value }))}
                  aria-invalid={messages.length > 0 || undefined}
                  aria-describedby={messages.length > 0 ? `${id}-help ${id}-error` : `${id}-help`}
                />
                <FieldDescription id={`${id}-help`}>{help}</FieldDescription>
                <FieldErrors id={`${id}-error`} messages={messages} />
              </Field>
            );
          })}
        </FieldGroup>
      </details>

      <input type="hidden" name="faqs" value={JSON.stringify(faqs.map(({ question, answer }) => ({ question, answer })))} />
      {faqs.length > 0 ? (
        <section aria-labelledby="agent-faqs-title" className="max-w-[640px] space-y-3 rounded-xl border p-4">
          <div className="space-y-1">
            <h2 id="agent-faqs-title" className="text-sm font-medium">
              Preguntas frecuentes propuestas
            </h2>
            <p className="text-sm text-muted-foreground">
              Las guardamos para tu base de conocimiento. Cámbialas si hace falta y quita las que no quieras.
            </p>
          </div>
          <ul className="divide-y">
            {faqs.map((faq, index) => {
              const id = `agent-faq-${faq.key}`;
              const questionErrors = fieldErrorsOf(state, `faqs.${index}.question`);
              const answerErrors = fieldErrorsOf(state, `faqs.${index}.answer`);
              const removeLabel = `Quitar la pregunta ${index + 1}`;
              return (
                <li key={faq.key} className="flex items-start gap-3 py-3">
                  <FieldGroup className="min-w-0 flex-1 gap-3">
                    <Field data-invalid={questionErrors.length > 0 || undefined}>
                      <FieldLabel htmlFor={`${id}-question`}>Pregunta {index + 1}</FieldLabel>
                      <Input
                        id={`${id}-question`}
                        maxLength={FAQ_QUESTION_MAX}
                        value={faq.question}
                        onChange={(event) => updateFaq(faq.key, { question: event.target.value })}
                        aria-invalid={questionErrors.length > 0 || undefined}
                        aria-describedby={questionErrors.length > 0 ? `${id}-question-error` : undefined}
                      />
                      <FieldErrors id={`${id}-question-error`} messages={questionErrors} />
                    </Field>
                    <Field data-invalid={answerErrors.length > 0 || undefined}>
                      <FieldLabel htmlFor={`${id}-answer`}>Respuesta {index + 1}</FieldLabel>
                      <Textarea
                        id={`${id}-answer`}
                        rows={2}
                        maxLength={FAQ_ANSWER_MAX}
                        value={faq.answer}
                        onChange={(event) => updateFaq(faq.key, { answer: event.target.value })}
                        aria-invalid={answerErrors.length > 0 || undefined}
                        aria-describedby={answerErrors.length > 0 ? `${id}-answer-error` : undefined}
                      />
                      <FieldErrors id={`${id}-answer-error`} messages={answerErrors} />
                    </Field>
                  </FieldGroup>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={removeLabel}
                        onClick={() => setFaqs((current) => current.filter((item) => item.key !== faq.key))}
                      >
                        <X aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{removeLabel}</TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
          <FieldErrors id="agent-faqs-error" messages={errors.faqs} />
        </section>
      ) : null}

      <FormMessage result={state} />
      <FormMessage result={skipState} />
      <StepFooter backHref={aiStepHref}>
        <SubmitButton variant="outline" formAction={skipFormAction} pending={skipping} pendingLabel="Un momento…" formNoValidate>
          Saltar este paso
        </SubmitButton>
        <SubmitButton pending={pending}>{data.agentId ? "Guardar y continuar" : "Crear agente y continuar"}</SubmitButton>
      </StepFooter>
    </form>
  );
}

type DraftPanelProps = { website: string | null; onDraft: (draft: SetupAgentDraft) => void };

/** «Generar desde la web del negocio», or from a description when the web cannot be read (docs/pantallas.md). */
function DraftPanel({ website, onDraft }: DraftPanelProps) {
  const [source, setSource] = useState<DraftSource>("url");
  const [url, setUrl] = useState(website ?? "");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<ActionResult<SetupAgentDraft> | null>(null);
  const [generating, startGenerating] = useTransition();
  const urlErrors = fieldErrorsOf(result ?? undefined, "url");
  const descriptionErrors = fieldErrorsOf(result ?? undefined, "description");
  /** A failure that is not about a field: no key, the web could not be read, the AI failed… */
  const failure = result && !result.ok && !result.fieldErrors ? result : null;

  const generate = () => {
    startGenerating(async () => {
      const next = await generateAgentDraftAction(source === "url" ? { source, url } : { source, description });
      setResult(next);
      if (next.ok && next.data) onDraft(next.data);
    });
  };

  // Enter in these fields generates the draft; it never submits the step (that would create the agent).
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!generating) generate();
  };

  const switchTo = (next: DraftSource) => {
    setSource(next);
    setResult(null);
  };

  return (
    <div className="max-w-[640px] space-y-4 rounded-xl border p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles aria-hidden className="size-4 text-ai" />
          Generar desde la web del negocio
        </p>
        <p className="text-sm text-muted-foreground">
          La IA lee tu web y adapta la plantilla a tu negocio: nombre, tono, instrucciones y preguntas frecuentes. Es un
          borrador: revísalo antes de crear el agente. Gasta un poco de saldo de OpenRouter.
        </p>
      </div>

      <div role="group" aria-label="Desde dónde generar" className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={source === "url" ? "secondary" : "ghost"} aria-pressed={source === "url"} onClick={() => switchTo("url")}>
          <Globe aria-hidden />
          Desde la web
        </Button>
        <Button
          type="button"
          size="sm"
          variant={source === "description" ? "secondary" : "ghost"}
          aria-pressed={source === "description"}
          onClick={() => switchTo("description")}
        >
          Con una descripción
        </Button>
      </div>

      {source === "url" ? (
        <Field data-invalid={urlErrors.length > 0 || undefined}>
          <FieldLabel htmlFor="agent-draft-url">Dirección de tu web</FieldLabel>
          <Input
            id="agent-draft-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://www.tunegocio.es"
            maxLength={URL_MAX}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={onEnter}
            aria-invalid={urlErrors.length > 0 || undefined}
            aria-describedby={urlErrors.length > 0 ? "agent-draft-url-error" : undefined}
          />
          <FieldErrors id="agent-draft-url-error" messages={urlErrors} />
        </Field>
      ) : (
        <Field data-invalid={descriptionErrors.length > 0 || undefined}>
          <FieldLabel htmlFor="agent-draft-description">Describe tu negocio</FieldLabel>
          <Textarea
            id="agent-draft-description"
            rows={4}
            maxLength={DRAFT_DESCRIPTION_MAX}
            placeholder="Qué haces, a quién atiendes, qué servicios ofreces y qué te distingue."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={descriptionErrors.length > 0 || undefined}
            aria-describedby={descriptionErrors.length > 0 ? "agent-draft-description-help agent-draft-description-error" : "agent-draft-description-help"}
          />
          <FieldDescription id="agent-draft-description-help">Al menos {DRAFT_DESCRIPTION_MIN} caracteres.</FieldDescription>
          <FieldErrors id="agent-draft-description-error" messages={descriptionErrors} />
        </Field>
      )}

      <div className="space-y-3">
        <Button type="button" variant="outline" onClick={generate} disabled={generating} aria-busy={generating || undefined}>
          {generating ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden />}
          {generating ? "Generando… puede tardar unos segundos" : "Generar borrador"}
        </Button>
        <div aria-live="polite" className="space-y-1">
          {!generating && result?.ok ? <StatusLight status="ok" label="Borrador listo" detail={result.message} /> : null}
          {!generating && failure ? (
            <>
              <StatusLight status="error" label="No se ha podido generar" detail={failure.error} />
              <p className="pl-6 text-xs text-muted-foreground">
                Seguimos con la plantilla de tu sector.
                {source === "url" ? (
                  <>
                    {" "}
                    También puedes{" "}
                    <button type="button" className="underline underline-offset-4 hover:text-primary" onClick={() => switchTo("description")}>
                      escribir una descripción del negocio
                    </button>
                    .
                  </>
                ) : null}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
