"use client";

import { CircleCheck, CircleX, FlaskConical, LoaderCircle } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomToolTestResult } from "@/data/custom-tools";
import type { ActionFailure } from "@/lib/action-result";
import { formatNumber } from "@/lib/format";
import type { HttpToolParameter } from "@/server/ai/tools/http-tool-definition";
import { testCustomToolAction } from "../actions";

/** Select value for «no value» of an optional parameter (Radix Select items cannot be empty). */
const NO_VALUE = "__sin_valor__";

/** The sample values as the model would send them: numbers and yes/no with their type; empty ones left out. */
function sampleArguments(parameters: readonly HttpToolParameter[], values: Readonly<Record<string, string>>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const parameter of parameters) {
    const raw = values[parameter.name] ?? "";
    if (raw === "" || raw === NO_VALUE) continue;
    if (parameter.type === "number") {
      const number = Number(raw.replace(",", "."));
      // Anything else goes as it is, and the server says it is not a number.
      args[parameter.name] = raw.trim() !== "" && Number.isFinite(number) ? number : raw;
    } else if (parameter.type === "boolean") {
      args[parameter.name] = raw === "true";
    } else {
      args[parameter.name] = raw;
    }
  }
  return args;
}

function ChoiceField({ parameter, value, onChange, invalid }: { parameter: HttpToolParameter; value: string; onChange: (value: string) => void; invalid: boolean }) {
  const choices = parameter.type === "boolean" ? [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] : parameter.options.map((option) => ({ value: option, label: option }));
  return (
    <Select value={value === "" ? NO_VALUE : value} onValueChange={onChange}>
      <SelectTrigger id={`sample-${parameter.name}`} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_VALUE}>Sin valor</SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * «Probar» ([HER-11]): calls the saved tool from the server with sample values and shows the status, the time and the
 * answer cut short. The secret headers are sent to the service, never shown here ([HER-12]).
 */
export function ToolTestPanel({ toolId, parameters }: { toolId: string; parameters: HttpToolParameter[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CustomToolTestResult | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const args = sampleArguments(parameters, values);
    startTransition(async () => {
      const answer = await testCustomToolAction({ toolId, args });
      if (answer.ok) {
        setFailure(null);
        setResult(answer.data ?? null);
      } else {
        setResult(null);
        setFailure(answer);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical aria-hidden className="size-4" />
          Probar
        </CardTitle>
        <CardDescription>Llama a la herramienta desde el servidor con valores de ejemplo y lo que está guardado. Las cabeceras secretas nunca se muestran.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <form onSubmit={run} className="grid gap-4" noValidate>
          {parameters.length === 0 ? <p className="text-sm text-muted-foreground">Esta herramienta no recibe datos.</p> : null}
          {parameters.map((parameter) => {
            const fieldId = `sample-${parameter.name}`;
            const invalid = Boolean(errors?.[parameter.name]);
            const value = values[parameter.name] ?? "";
            const set = (next: string) => setValues((current) => ({ ...current, [parameter.name]: next }));
            return (
              <Field key={parameter.name} data-invalid={invalid || undefined}>
                <FieldLabel htmlFor={fieldId} className="font-mono">
                  {parameter.name}
                  {parameter.required ? null : <span className="font-sans font-normal text-muted-foreground"> (opcional)</span>}
                </FieldLabel>
                {parameter.type === "boolean" || parameter.type === "enum" ? (
                  <ChoiceField parameter={parameter} value={value} onChange={set} invalid={invalid} />
                ) : (
                  <Input
                    id={fieldId}
                    value={value}
                    onChange={(event) => set(event.target.value)}
                    inputMode={parameter.type === "number" ? "decimal" : undefined}
                    autoComplete="off"
                    aria-invalid={invalid || undefined}
                  />
                )}
                {parameter.description ? <FieldDescription>{parameter.description}</FieldDescription> : null}
                <FieldError errors={errors?.[parameter.name]?.map((message) => ({ message }))} />
              </Field>
            );
          })}
          {failure ? <FormMessage result={failure} /> : null}
          <Button type="submit" variant="outline" className="w-fit" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {pending ? "Probando…" : "Probar"}
          </Button>
        </form>

        {result ? (
          <section aria-labelledby="test-result-heading" aria-live="polite" className="grid gap-3">
            <h3 id="test-result-heading" className="text-sm font-semibold">
              Resultado
            </h3>
            <dl className="grid gap-1 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Estado</dt>
                <dd>
                  {result.ok ? (
                    <Badge variant="outline" className="h-[22px] border-transparent bg-success-soft text-success">
                      <CircleCheck aria-hidden />
                      Correcto · {result.status}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-[22px] border-transparent bg-destructive-soft text-destructive-text">
                      <CircleX aria-hidden />
                      {result.status ? `Error · ${result.status}` : "Error"}
                    </Badge>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Tiempo</dt>
                <dd className="tabular-nums">{formatNumber(result.durationMs)} ms</dd>
              </div>
            </dl>
            {result.error ? (
              <p role="alert" className="text-sm text-destructive-text">
                {result.error}
              </p>
            ) : null}
            {result.response ? (
              <div className="grid gap-1">
                <p className="text-sm text-muted-foreground">{result.truncated ? "Respuesta (recortada, como la recibe la IA)" : "Respuesta, como la recibe la IA"}</p>
                <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap">{result.response}</pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin respuesta.</p>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
