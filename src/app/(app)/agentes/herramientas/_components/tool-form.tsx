"use client";

import { LoaderCircle, Plus, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { SecretField } from "@/components/secret-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/action-result";
import { HTTP_METHODS, type HttpMethod } from "@/lib/enums";
import { HTTP_TOOL_LIMITS, HTTP_TOOL_PARAM_TYPE_LABELS, HTTP_TOOL_PARAM_TYPES, type HttpToolParameter, type HttpToolParamType } from "@/server/ai/tools/http-tool-definition";
import { saveCustomToolAction } from "../actions";
import { httpToolPath } from "../_lib/paths";

/** What the form starts with: a saved tool, or an empty one. Secret headers come only masked. */
export type ToolFormValues = {
  id: string | null;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  timeoutSeconds: number;
  parameters: HttpToolParameter[];
  headers: { name: string; masked: string }[];
  /** False when the saved headers cannot be read (the encryption key changed). */
  headersReadable: boolean;
};

type ParameterRow = { key: number; name: string; type: HttpToolParamType; description: string; required: boolean; options: string };
/** `original`: the saved header whose value the row keeps until «Cambiar» ([HER-12]). */
type HeaderRow = { key: number; name: string; original: string | null; masked: string | null };

const isMethod = (value: string): value is HttpMethod => (HTTP_METHODS as readonly string[]).includes(value);
const isParamType = (value: string): value is HttpToolParamType => (HTTP_TOOL_PARAM_TYPES as readonly string[]).includes(value);

/** A key no row of the list has (rows are only added from a click). */
function nextKeyOf(rows: readonly { key: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.key), 0) + 1;
}

function splitOptions(text: string): string[] {
  return text
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");
}

/**
 * Nueva herramienta / a tool's form ([HER-11], [HER-12]): name and description for the AI, the data the AI sends, the
 * method and the address, the secret headers and the time limit. The server validates everything again; secret values
 * are never sent to the browser: saved ones show «••••1234» and are only replaced with «Cambiar».
 */
export function ToolForm({ tool }: { tool: ToolFormValues }) {
  const router = useRouter();
  const [name, setName] = useState(tool.name);
  const [description, setDescription] = useState(tool.description);
  const [method, setMethod] = useState<HttpMethod>(tool.method);
  const [url, setUrl] = useState(tool.url);
  const [timeout, setTimeoutText] = useState(String(tool.timeoutSeconds));
  const [parameters, setParameters] = useState<ParameterRow[]>(() =>
    tool.parameters.map((parameter, index) => ({ ...parameter, options: parameter.options.join(", "), key: index + 1 })),
  );
  const [headers, setHeaders] = useState<HeaderRow[]>(() => tool.headers.map((header, index) => ({ name: header.name, original: header.name, masked: header.masked, key: index + 1 })));
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;
  const errorOf = (path: string) => errors?.[path]?.map((message) => ({ message }));
  const invalid = (path: string) => (errors?.[path] ? true : undefined);

  function changeParameter(key: number, change: Partial<ParameterRow>) {
    setParameters((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function changeHeader(key: number, change: Partial<HeaderRow>) {
    setHeaders((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The secret values are read from their own fields only now; a saved one not changed is not in the form.
    const form = new FormData(event.currentTarget);
    const seconds = Number(timeout);
    const input = {
      name,
      description,
      method,
      url,
      timeoutSeconds: timeout.trim() !== "" && Number.isFinite(seconds) ? seconds : null,
      parameters: parameters.map((row) => ({
        name: row.name,
        type: row.type,
        description: row.description,
        required: row.required,
        options: row.type === "enum" ? splitOptions(row.options) : [],
      })),
      headers: headers.map((row) => {
        const typed = form.get(`header-value-${row.key}`);
        return {
          name: row.name,
          ...(typeof typed === "string" && typed !== "" ? { value: typed } : {}),
          ...(row.original ? { keep: row.original } : {}),
        };
      }),
    };
    startTransition(async () => {
      const result = await saveCustomToolAction({ ...(tool.id ? { toolId: tool.id } : {}), tool: input });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      toast.success(result.message ?? "Herramienta guardada.");
      if (!tool.id && result.data) router.push(httpToolPath(result.data.id));
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-[640px] gap-8" noValidate>
      {failure ? <FormMessage result={failure} /> : null}

      <section aria-labelledby="tool-data-heading" className="grid gap-5">
        <h2 id="tool-data-heading" className="text-base font-semibold">
          Qué hace
        </h2>
        <Field data-invalid={invalid("name")}>
          <FieldLabel htmlFor="tool-name">Nombre</FieldLabel>
          <Input
            id="tool-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={HTTP_TOOL_LIMITS.nameMax}
            autoComplete="off"
            spellCheck={false}
            placeholder="consultar_pedido"
            className="font-mono"
            aria-invalid={invalid("name")}
          />
          <FieldDescription>La IA la llama por este nombre: minúsculas sin tildes, números y _ (por ejemplo, consultar_pedido).</FieldDescription>
          <FieldError errors={errorOf("name")} />
        </Field>
        <Field data-invalid={invalid("description")}>
          <FieldLabel htmlFor="tool-description">Descripción para la IA</FieldLabel>
          <Textarea
            id="tool-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={HTTP_TOOL_LIMITS.descriptionMax}
            rows={3}
            placeholder="Consulta el estado de un pedido de la tienda por su número. Úsala cuando el cliente pregunte por su pedido."
            aria-invalid={invalid("description")}
          />
          <FieldDescription>Qué hace y cuándo usarla: la IA lo lee para decidir cuándo llamarla.</FieldDescription>
          <FieldError errors={errorOf("description")} />
        </Field>
      </section>

      <section aria-labelledby="tool-parameters-heading" className="grid gap-4">
        <div className="space-y-1">
          <h2 id="tool-parameters-heading" className="text-base font-semibold">
            Datos que envía la IA
          </h2>
          <p className="text-sm text-muted-foreground">
            Lo que la IA rellena en cada llamada, sacado de la conversación. Se comprueban antes de llamar.
          </p>
        </div>
        {parameters.length === 0 ? <p className="text-sm text-muted-foreground">Sin datos: la IA la llamará sin enviar nada.</p> : null}
        {parameters.map((row, index) => {
          const base = `parameters.${index}`;
          const id = `param-${row.key}`;
          return (
            <fieldset key={row.key} className="grid gap-4 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Dato {index + 1}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={invalid(`${base}.name`)}>
                  <FieldLabel htmlFor={`${id}-name`}>Nombre</FieldLabel>
                  <Input
                    id={`${id}-name`}
                    value={row.name}
                    onChange={(event) => changeParameter(row.key, { name: event.target.value })}
                    maxLength={HTTP_TOOL_LIMITS.parameterNameMax}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="numero_pedido"
                    className="font-mono"
                    aria-invalid={invalid(`${base}.name`)}
                  />
                  <FieldError errors={errorOf(`${base}.name`)} />
                </Field>
                <Field data-invalid={invalid(`${base}.type`)}>
                  <FieldLabel htmlFor={`${id}-type`}>Tipo</FieldLabel>
                  <Select value={row.type} onValueChange={(value) => (isParamType(value) ? changeParameter(row.key, { type: value }) : undefined)}>
                    <SelectTrigger id={`${id}-type`} className="w-full" aria-invalid={invalid(`${base}.type`)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HTTP_TOOL_PARAM_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {HTTP_TOOL_PARAM_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={errorOf(`${base}.type`)} />
                </Field>
              </div>
              <Field data-invalid={invalid(`${base}.description`)}>
                <FieldLabel htmlFor={`${id}-description`}>Descripción (opcional)</FieldLabel>
                <Input
                  id={`${id}-description`}
                  value={row.description}
                  onChange={(event) => changeParameter(row.key, { description: event.target.value })}
                  maxLength={HTTP_TOOL_LIMITS.parameterDescriptionMax}
                  placeholder="El número del pedido, tal como lo da el cliente"
                  aria-invalid={invalid(`${base}.description`)}
                />
                <FieldError errors={errorOf(`${base}.description`)} />
              </Field>
              {row.type === "enum" ? (
                <Field data-invalid={invalid(`${base}.options`)}>
                  <FieldLabel htmlFor={`${id}-options`}>Opciones</FieldLabel>
                  <Input
                    id={`${id}-options`}
                    value={row.options}
                    onChange={(event) => changeParameter(row.key, { options: event.target.value })}
                    placeholder="urgente, normal"
                    aria-invalid={invalid(`${base}.options`)}
                  />
                  <FieldDescription>Separadas por comas. La IA solo puede elegir una de ellas.</FieldDescription>
                  <FieldError errors={errorOf(`${base}.options`)} />
                </Field>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox id={`${id}-required`} checked={row.required} onCheckedChange={(checked) => changeParameter(row.key, { required: checked === true })} />
                  <Label htmlFor={`${id}-required`} className="font-normal">
                    Obligatorio
                  </Label>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setParameters((rows) => rows.filter((candidate) => candidate.key !== row.key))}>
                  <X aria-hidden />
                  Quitar dato {index + 1}
                </Button>
              </div>
            </fieldset>
          );
        })}
        {errors?.parameters ? (
          <p role="alert" className="text-sm text-destructive-text">
            {errors.parameters[0]}
          </p>
        ) : null}
        {parameters.length < HTTP_TOOL_LIMITS.parameters ? (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => setParameters((rows) => [...rows, { key: nextKeyOf(rows), name: "", type: "string", description: "", required: true, options: "" }])}
          >
            <Plus aria-hidden />
            Añadir dato
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="tool-call-heading" className="grid gap-5">
        <h2 id="tool-call-heading" className="text-base font-semibold">
          A dónde llama
        </h2>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field data-invalid={invalid("method")}>
            <FieldLabel htmlFor="tool-method">Método</FieldLabel>
            <Select value={method} onValueChange={(value) => (isMethod(value) ? setMethod(value) : undefined)}>
              <SelectTrigger id="tool-method" className="w-full font-mono" aria-invalid={invalid("method")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_METHODS.map((value) => (
                  <SelectItem key={value} value={value} className="font-mono">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={errorOf("method")} />
          </Field>
          <Field data-invalid={invalid("timeoutSeconds")}>
            <FieldLabel htmlFor="tool-timeout">Tiempo máximo (segundos)</FieldLabel>
            <Input
              id="tool-timeout"
              inputMode="numeric"
              value={timeout}
              onChange={(event) => setTimeoutText(event.target.value)}
              className="w-24 tabular-nums"
              aria-invalid={invalid("timeoutSeconds")}
            />
            <FieldDescription>
              Entre {HTTP_TOOL_LIMITS.timeoutMinSeconds} y {HTTP_TOOL_LIMITS.timeoutMaxSeconds}. Si el servicio tarda más, se corta y la IA recibe un error.
            </FieldDescription>
            <FieldError errors={errorOf("timeoutSeconds")} />
          </Field>
        </div>
        <Field data-invalid={invalid("url")}>
          <FieldLabel htmlFor="tool-url">Dirección</FieldLabel>
          <Input
            id="tool-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            maxLength={HTTP_TOOL_LIMITS.urlMax}
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            placeholder="https://tu-crm.com/api/pedidos/{numero_pedido}"
            className="font-mono"
            aria-invalid={invalid("url")}
          />
          <FieldDescription>
            Empieza por https://. Pon los datos entre llaves, como {"{numero_pedido}"}: solo en la ruta o tras «?», nunca en el nombre del servidor.{" "}
            {method === "GET"
              ? "Los datos que no van en la dirección se añaden al final (?nombre=valor)."
              : "Los datos que no van en la dirección se envían en el cuerpo, en JSON."}{" "}
            No pongas claves aquí: van en las cabeceras secretas.
          </FieldDescription>
          <FieldError errors={errorOf("url")} />
        </Field>
      </section>

      <section aria-labelledby="tool-headers-heading" className="grid gap-4">
        <div className="space-y-1">
          <h2 id="tool-headers-heading" className="text-base font-semibold">
            Cabeceras secretas
          </h2>
          <p className="text-sm text-muted-foreground">
            Para la clave del servicio (por ejemplo, Authorization o X-Api-Key). Se guardan cifradas, nunca se vuelven a mostrar enteras y solo se envían a
            esta dirección: si la cambias, hay que volver a escribirlas.
          </p>
        </div>
        {!tool.headersReadable ? (
          <Alert className="border-transparent bg-warning-soft text-warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>Las cabeceras guardadas no se pueden leer</AlertTitle>
            <AlertDescription>Ha cambiado la clave de cifrado de la instalación. Vuelve a añadirlas con su valor.</AlertDescription>
          </Alert>
        ) : null}
        {headers.map((row, index) => {
          const base = `headers.${index}`;
          const id = `header-${row.key}`;
          return (
            <fieldset key={row.key} className="grid gap-4 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Cabecera {index + 1}</legend>
              <Field data-invalid={invalid(`${base}.name`)}>
                <FieldLabel htmlFor={`${id}-name`}>Nombre</FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={row.name}
                  onChange={(event) => changeHeader(row.key, { name: event.target.value })}
                  maxLength={HTTP_TOOL_LIMITS.headerNameMax}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="X-Api-Key"
                  className="font-mono"
                  aria-invalid={invalid(`${base}.name`)}
                />
                <FieldError errors={errorOf(`${base}.name`)} />
              </Field>
              <SecretField name={`header-value-${row.key}`} label="Valor" masked={row.masked} error={errors?.[`${base}.value`]?.[0]} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => setHeaders((rows) => rows.filter((candidate) => candidate.key !== row.key))}
              >
                <X aria-hidden />
                Quitar cabecera {index + 1}
              </Button>
            </fieldset>
          );
        })}
        {headers.length < HTTP_TOOL_LIMITS.headers ? (
          <Button type="button" variant="outline" className="w-fit" onClick={() => setHeaders((rows) => [...rows, { key: nextKeyOf(rows), name: "", original: null, masked: null }])}>
            <Plus aria-hidden />
            Añadir cabecera
          </Button>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : tool.id ? "Guardar cambios" : "Crear herramienta"}
        </Button>
      </div>
    </form>
  );
}
