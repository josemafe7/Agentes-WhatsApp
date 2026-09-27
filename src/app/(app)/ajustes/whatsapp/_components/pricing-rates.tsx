"use client";

import { LoaderCircle, Pencil, Save, Tags, Trash2 } from "lucide-react";
import { useRef, useState, useTransition, type FormEvent, type RefObject } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import { deletePricingRateAction, savePricingRateAction } from "../actions";
import { formatRate, marketName, PRICING_CATEGORY_OPTIONS, pricingCategoryLabel } from "../_lib/labels";

/** `market` (the country's name) and `updated` come worded from the server, so both renders match. */
export type PricingRateView = { id: string; country: string; market: string; category: string; price: number; currency: string; isExample: boolean; updated: string };

type FormValues = { country: string; category: string; price: string };

const EMPTY: FormValues = { country: "", category: "utility", price: "" };

/** The price as the person types it back: with a comma, as Spanish numbers are written. */
const priceText = (price: number) => String(price).replace(".", ",");

function RateForm({ values, onChange, formRef }: { values: FormValues; onChange: (values: FormValues) => void; formRef: RefObject<HTMLFormElement | null> }) {
  const [result, setResult] = useState<ActionResult | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const errorsOf = (field: string) => (result && !result.ok ? result.fieldErrors?.[field]?.map((message) => ({ message })) : undefined);
  const market = /^[a-zA-Z]{2}$/.test(values.country.trim()) ? marketName(values.country.trim()) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const next = await savePricingRateAction(values);
      if (!next.ok) {
        setResult(next);
        return;
      }
      setResult(undefined);
      toast.success(next.message ?? "Tarifa guardada.");
      onChange(EMPTY);
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid gap-4 rounded-xl border p-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">Añadir o cambiar una tarifa</h3>
        <p className="text-sm text-muted-foreground">Si ya hay una tarifa para ese mercado y esa categoría, se sustituye.</p>
      </div>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errorsOf("country") ? true : undefined}>
            <FieldLabel htmlFor="rate-country">Mercado</FieldLabel>
            <Input
              id="rate-country"
              value={values.country}
              maxLength={2}
              autoComplete="off"
              spellCheck={false}
              placeholder="ES"
              className="font-mono uppercase"
              onChange={(event) => onChange({ ...values, country: event.target.value.toUpperCase() })}
              aria-invalid={errorsOf("country") ? true : undefined}
              aria-describedby="rate-country-help"
            />
            <FieldDescription id="rate-country-help">{market ? `${market}.` : "Código de país de dos letras, como ES, MX o US."}</FieldDescription>
            <FieldError errors={errorsOf("country")} />
          </Field>
          <Field data-invalid={errorsOf("category") ? true : undefined}>
            <FieldLabel htmlFor="rate-category">Categoría de Meta</FieldLabel>
            <Select value={values.category} onValueChange={(category) => onChange({ ...values, category })}>
              <SelectTrigger id="rate-category" className="w-full" aria-invalid={errorsOf("category") ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={errorsOf("category")} />
          </Field>
        </div>
        <Field data-invalid={errorsOf("price") ? true : undefined} className="sm:max-w-64">
          <FieldLabel htmlFor="rate-price">Precio por mensaje</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="rate-price"
              value={values.price}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,0509"
              className="tabular-nums"
              onChange={(event) => onChange({ ...values, price: event.target.value })}
              aria-invalid={errorsOf("price") ? true : undefined}
              aria-describedby="rate-price-help"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>US$</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription id="rate-price-help">En dólares (USD), como en la tabla de Meta.</FieldDescription>
          <FieldError errors={errorsOf("price")} />
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Save aria-hidden />}
          {pending ? "Guardando…" : "Guardar tarifa"}
        </Button>
        <FormMessage result={result} />
      </div>
    </form>
  );
}

async function removeRate(rateId: string) {
  const result = await deletePricingRateAction(rateId);
  if (result.ok) toast.success(result.message ?? "Tarifa borrada.");
  else toast.error(result.error);
}

function RateActions({ rate, onEdit }: { rate: PricingRateView; onEdit: (rate: PricingRateView) => void }) {
  const name = `${pricingCategoryLabel(rate.category)} en ${rate.market}`;
  return (
    <div className="flex justify-end gap-1">
      <Button type="button" variant="ghost" size="icon" aria-label={`Cambiar la tarifa de ${name}`} onClick={() => onEdit(rate)}>
        <Pencil aria-hidden />
      </Button>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="ghost" size="icon" aria-label={`Borrar la tarifa de ${name}`}>
            <Trash2 aria-hidden />
          </Button>
        }
        title={`¿Borrar la tarifa de ${name}?`}
        description="Los mensajes cobrados de ese mercado y esa categoría dejarán de tener coste estimado, y el informe lo señalará."
        confirmLabel="Borrar tarifa"
        destructive
        onConfirm={() => removeRate(rate.id)}
      />
    </div>
  );
}

/** Editable per-message rates by market and category ([AJU-09]): a table from 768 px, cards below, and the form. */
export function PricingRates({ rates }: { rates: PricingRateView[] }) {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const formRef = useRef<HTMLFormElement>(null);

  function edit(rate: PricingRateView) {
    setValues({ country: rate.country, category: rate.category, price: priceText(rate.price) });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    formRef.current?.querySelector<HTMLInputElement>("#rate-price")?.focus({ preventScroll: true });
  }

  return (
    <div className="grid gap-4">
      {rates.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Tags}
            title="Todavía no hay tarifas"
            description="Sin tarifa, el coste de los mensajes que Meta cobra no se estima y el informe lo señala. Añade la de tus mercados abajo."
          />
        </div>
      ) : (
        <>
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mercado</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Precio por mensaje</TableHead>
                  <TableHead>Actualizada</TableHead>
                  <TableHead>
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{rate.market}</span>
                        <span className="font-mono text-xs text-muted-foreground">{rate.country}</span>
                        {rate.isExample ? <Badge variant="secondary">Ejemplo</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>{pricingCategoryLabel(rate.category)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(rate.price)}
                      <span className="sr-only"> ({rate.currency})</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{rate.updated}</TableCell>
                    <TableCell className="w-24">
                      <RateActions rate={rate} onEdit={edit} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {rates.map((rate) => (
              <li key={rate.id} className="flex items-start justify-between gap-3 rounded-xl border p-4">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{rate.market}</span>
                    <span className="font-mono text-xs text-muted-foreground">{rate.country}</span>
                    {rate.isExample ? <Badge variant="secondary">Ejemplo</Badge> : null}
                  </div>
                  <p className="text-sm">
                    {pricingCategoryLabel(rate.category)} · <span className="tabular-nums">{formatRate(rate.price)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Actualizada: {rate.updated}</p>
                </div>
                <RateActions rate={rate} onEdit={edit} />
              </li>
            ))}
          </ul>
        </>
      )}
      <RateForm values={values} onChange={setValues} formRef={formRef} />
    </div>
  );
}
