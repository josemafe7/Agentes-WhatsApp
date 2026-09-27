"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionFailure } from "@/lib/action-result";
import { updateContactAction } from "../actions";
import { CUSTOM_FIELD_NAME_MAX, CUSTOM_FIELD_VALUE_MAX, customFieldsFromRows, rowsFromCustomFields, type CustomFieldRow } from "../_lib/custom-fields";

type EditableRow = CustomFieldRow & { uid: number };

const isEmptyRow = (row: CustomFieldRow) => row.key.trim() === "" && row.value.trim() === "";

/** «Campos personalizados» of the card ([CTO-02]): any name and value (alergias, color favorito…), saved together. */
export function CustomFieldsEditor({ contactId, fields }: { contactId: string; fields: Record<string, string> }) {
  const router = useRouter();
  const [rows, setRows] = useState<EditableRow[]>(() => rowsFromCustomFields(fields).map((row, uid) => ({ ...row, uid })));
  const [saved, setSaved] = useState(() => JSON.stringify(fields));
  /** Errors by row uid, so they stay on their row when another one is removed. */
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [addedUid, setAddedUid] = useState<number | null>(null);
  const addedKeyRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const checked = customFieldsFromRows(rows);
  const dirty = !checked.ok || JSON.stringify(checked.fields) !== saved;

  // «Añadir campo» takes the focus to the new row's name.
  useEffect(() => {
    addedKeyRef.current?.focus();
  }, [addedUid]);

  function update(uid: number, change: Partial<CustomFieldRow>) {
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...change } : row)));
    // Its error goes away as soon as the row changes; it is checked again on saving.
    setRowErrors((current) => {
      if (!(uid in current)) return current;
      const next = { ...current };
      delete next[uid];
      return next;
    });
  }

  function addRow() {
    const uid = Math.max(-1, ...rows.map((row) => row.uid)) + 1;
    setRows((current) => [...current, { key: "", value: "", uid }]);
    setAddedUid(uid);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!checked.ok) {
      setRowErrors(Object.fromEntries(Object.entries(checked.errors).map(([index, message]) => [rows[Number(index)].uid, message])));
      return;
    }
    setRowErrors({});
    const next = checked.fields;
    startTransition(async () => {
      const result = await updateContactAction(contactId, { customFields: next });
      if (!result.ok) {
        setFailure({ ...result, error: result.fieldErrors?.customFields?.[0] ?? result.error });
        return;
      }
      setFailure(null);
      setSaved(JSON.stringify(next));
      setRows((current) => current.filter((row) => !isEmptyRow(row)));
      toast.success(result.message ?? "Cambios guardados.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin campos. Añade los datos que quieras guardar de este contacto, como alergias o preferencias.</p>
      ) : (
        <div className="grid gap-3">
          <div aria-hidden className="hidden grid-cols-[minmax(0,14rem)_minmax(0,1fr)_2.25rem] gap-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Campo</span>
            <span>Valor</span>
          </div>
          <ul className="grid gap-4 sm:gap-3">
            {rows.map((row, index) => {
              const error = rowErrors[row.uid];
              const errorId = `custom-field-${row.uid}-error`;
              return (
                <li key={row.uid} className="grid gap-1">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
                    <Input
                      ref={row.uid === addedUid ? addedKeyRef : undefined}
                      aria-label={`Nombre del campo ${index + 1}`}
                      placeholder="Campo"
                      value={row.key}
                      maxLength={CUSTOM_FIELD_NAME_MAX}
                      onChange={(event) => update(row.uid, { key: event.target.value })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                    />
                    <Input
                      aria-label={`Valor del campo ${index + 1}`}
                      placeholder="Valor"
                      value={row.value}
                      maxLength={CUSTOM_FIELD_VALUE_MAX}
                      onChange={(event) => update(row.uid, { value: event.target.value })}
                      className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="row-span-2 self-center sm:row-span-1"
                      aria-label={`Quitar el campo ${row.key.trim() || index + 1}`}
                      onClick={() => setRows((current) => current.filter((item) => item.uid !== row.uid))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  {error ? (
                    <p id={errorId} className="text-sm text-destructive-text">
                      {error}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={addRow}>
          <Plus aria-hidden />
          Añadir campo
        </Button>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar campos"}
        </Button>
        <FormMessage result={failure ?? undefined} />
      </div>
    </form>
  );
}
