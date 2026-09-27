"use client";

import { LoaderCircle, MessageCircle, Search, UserPlus, UserRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { ActionResult } from "@/lib/action-result";
import { searchContactsAction, type ContactOption } from "../actions";
import type { CustomerChoice } from "../_lib/booking-form";
import type { AgendaWords } from "../_lib/labels";
import { AgendaField, fieldDescribedBy } from "./agenda-field";


const MIN_SEARCH = 2;
const DEBOUNCE_MS = 250;
const SEARCH_FAILED = "No se ha podido buscar. Inténtalo de nuevo.";
const SEARCH_HELP = "Busca por nombre, teléfono o email.";

type CustomerPickerProps = {
  value: CustomerChoice;
  onChange: (value: CustomerChoice) => void;
  words: AgendaWords;
  /** Phone and email of a new customer only when a contact card will be created with them. */
  withContactDetails: boolean;
  /** Heading of the name-only form (default «Nuevo cliente»). */
  newLegend?: string;
  errors?: Record<string, string[]>;
};

/** «Cliente»: search the contacts the person may see ([PER-02]) or write a new customer ([AGD-14]). */
export function CustomerPicker({ value, onChange, words, withContactDetails, newLegend, errors }: CustomerPickerProps) {
  const id = useId();
  if (value.kind === "conversation") {
    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">{words.Customer}</p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageCircle aria-hidden className="size-4" />
          El {words.customer} de la conversación
        </p>
      </div>
    );
  }
  if (value.kind === "existing") {
    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">{words.Customer}</p>
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{value.name}</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ kind: "none" })}>
            Cambiar
          </Button>
        </div>
      </div>
    );
  }
  if (value.kind === "new") {
    const nameErrors = errors?.contactName ?? errors?.name;
    return (
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">{newLegend ?? `Nuevo ${words.customer}`}</legend>
        <AgendaField id={`${id}-name`} label="Nombre" errors={nameErrors}>
          <Input
            id={`${id}-name`}
            value={value.name}
            maxLength={100}
            autoComplete="off"
            aria-invalid={nameErrors ? true : undefined}
            aria-describedby={fieldDescribedBy(`${id}-name`, { errors: nameErrors })}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
          />
        </AgendaField>
        {withContactDetails ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <AgendaField id={`${id}-phone`} label="Teléfono" optional errors={errors?.phone}>
              <Input
                id={`${id}-phone`}
                type="tel"
                value={value.phone}
                maxLength={32}
                autoComplete="off"
                aria-invalid={errors?.phone ? true : undefined}
                aria-describedby={fieldDescribedBy(`${id}-phone`, { errors: errors?.phone })}
                onChange={(event) => onChange({ ...value, phone: event.target.value })}
              />
            </AgendaField>
            <AgendaField id={`${id}-email`} label="Email" optional errors={errors?.email}>
              <Input
                id={`${id}-email`}
                type="email"
                value={value.email}
                maxLength={254}
                autoComplete="off"
                aria-invalid={errors?.email ? true : undefined}
                aria-describedby={fieldDescribedBy(`${id}-email`, { errors: errors?.email })}
                onChange={(event) => onChange({ ...value, email: event.target.value })}
              />
            </AgendaField>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {withContactDetails ? `Se creará su ficha en Contactos.` : `Se guarda solo el nombre en la ${words.booking}.`}
        </p>
        <Button type="button" variant="link" className="h-auto justify-self-start p-0" onClick={() => onChange({ kind: "none" })}>
          Buscar un {words.customer} que ya existe
        </Button>
      </fieldset>
    );
  }
  return <CustomerSearch id={id} words={words} onChange={onChange} errors={errors?.contactId} />;
}

function CustomerSearch({ id, words, onChange, errors }: { id: string; words: AgendaWords; onChange: (value: CustomerChoice) => void; errors?: string[] }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; result: ActionResult<ContactOption[]> } | null>(null);
  const text = query.trim();

  useEffect(() => {
    if (text.length < MIN_SEARCH) return;
    let current = true;
    const timer = setTimeout(() => {
      searchContactsAction(text).then(
        (result) => {
          if (current) setFound({ query: text, result });
        },
        () => {
          if (current) setFound({ query: text, result: { ok: false, error: SEARCH_FAILED } });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);

  const result = text.length >= MIN_SEARCH && found?.query === text ? found.result : null;
  const searching = text.length >= MIN_SEARCH && result === null;
  const inputId = `${id}-search`;

  return (
    <div className="grid gap-2">
      <AgendaField id={inputId} label={words.Customer} errors={errors} help={SEARCH_HELP}>
        <InputGroup>
          <InputGroupInput
            id={inputId}
            type="search"
            value={query}
            maxLength={100}
            autoComplete="off"
            aria-invalid={errors ? true : undefined}
            aria-describedby={fieldDescribedBy(inputId, { help: SEARCH_HELP, errors })}
            onChange={(event) => setQuery(event.target.value)}
          />
          <InputGroupAddon>{searching ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Search aria-hidden />}</InputGroupAddon>
        </InputGroup>
      </AgendaField>
      <div aria-live="polite" className="grid gap-1">
        {result && !result.ok ? <p className="text-sm text-destructive-text">{result.error}</p> : null}
        {result?.ok && result.data?.length === 0 ? <p className="text-sm text-muted-foreground">No hay nadie con «{text}».</p> : null}
        {result?.ok && result.data?.length ? (
          <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-1">
            {result.data.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                  onClick={() => onChange({ kind: "existing", id: contact.id, name: contact.name })}
                >
                  <span className="truncate font-medium">{contact.name}</span>
                  {contact.detail ? <span className="truncate text-xs text-muted-foreground">{contact.detail}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange({ kind: "new", name: text, phone: "", email: "" })}>
        <UserPlus aria-hidden />
        Nuevo {words.customer}
      </Button>
    </div>
  );
}
