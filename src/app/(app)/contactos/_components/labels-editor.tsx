"use client";

import { CircleAlert, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labelSchema, MAX_LABELS } from "@/lib/validation";
import { updateContactAction } from "../actions";

type LabelsEditorProps = {
  contactId: string;
  labels: string[];
  /** Labels already in use on other contacts, offered while typing. */
  suggestions: string[];
};

const sameLabel = (a: string, b: string) => a.toLocaleLowerCase("es") === b.toLocaleLowerCase("es");

/** «Etiquetas» of the card ([CTO-01], [CTO-02]): each change is saved at once; a failed save puts them back. */
export function LabelsEditor({ contactId, labels, suggestions }: LabelsEditorProps) {
  const router = useRouter();
  const listId = useId();
  const [current, setCurrent] = useState(labels);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: string[], message: string) {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await updateContactAction(contactId, { labels: next });
      if (!result.ok) {
        setCurrent(previous);
        setError(result.fieldErrors?.labels?.[0] ?? result.error);
        return;
      }
      setError(null);
      toast.success(message);
      router.refresh();
    });
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = labelSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Escribe la etiqueta.");
      return;
    }
    if (current.some((label) => sameLabel(label, parsed.data))) {
      setError("Ya tiene esta etiqueta.");
      return;
    }
    if (current.length >= MAX_LABELS) {
      setError(`Como mucho ${MAX_LABELS} etiquetas.`);
      return;
    }
    // Reuse the spelling already in use, so the filter does not list «VIP» and «vip».
    const label = suggestions.find((suggestion) => sameLabel(suggestion, parsed.data)) ?? parsed.data;
    setDraft("");
    save([...current, label], `Etiqueta «${label}» añadida.`);
  }

  const offered = suggestions.filter((suggestion) => !current.some((label) => sameLabel(label, suggestion)));

  return (
    <div className="grid gap-4">
      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin etiquetas. Sirven para agrupar contactos y filtrar el listado.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Etiquetas del contacto">
          {current.map((label) => (
            <li key={label} className="inline-flex h-7 max-w-full items-center gap-0.5 rounded-full border pl-2.5 text-xs font-medium pointer-coarse:h-11">
              <span className="truncate">{label}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  save(
                    current.filter((item) => item !== label),
                    `Etiqueta «${label}» quitada.`,
                  )
                }
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 pointer-coarse:size-11"
                aria-label={`Quitar la etiqueta ${label}`}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate className="flex max-w-md gap-2">
        <Input
          aria-label="Nueva etiqueta"
          placeholder="Nueva etiqueta"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          list={listId}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${listId}-error` : undefined}
        />
        <datalist id={listId}>
          {offered.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <Button type="submit" variant="outline" disabled={pending}>
          <Plus aria-hidden />
          Añadir
        </Button>
      </form>
      {error ? (
        <p id={`${listId}-error`} role="alert" className="flex items-center gap-2 text-sm text-destructive-text">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
