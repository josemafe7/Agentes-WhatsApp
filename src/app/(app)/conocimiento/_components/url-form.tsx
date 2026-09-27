"use client";

import { LoaderCircle } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ActionFailure } from "@/lib/action-result";
import { SITEMAP_MAX_PAGES } from "@/lib/knowledge-limits";
import { addKnowledgeUrlAction } from "../[id]/actions";
import { REFRESH_INTERVAL_OPTIONS } from "../_lib/labels";
import { TextField } from "./form-fields";

const DEFAULT_INTERVAL = String(REFRESH_INTERVAL_OPTIONS[1].hours);

/**
 * «Añadir contenido › Página web» ([CON-04], [CON-09]): the address, optionally the pages of its sitemap, and whether
 * to read it again from time to time (only changed pages are processed again).
 */
export function UrlForm({ kbId, onDone }: { kbId: string; onDone: () => void }) {
  const [sitemap, setSitemap] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [intervalHours, setIntervalHours] = useState(DEFAULT_INTERVAL);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    const input = { url, sitemap, refresh, ...(refresh ? { refreshIntervalHours: Number(intervalHours) } : {}) };
    startTransition(async () => {
      const result = await addKnowledgeUrlAction(kbId, input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Página añadida.");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FieldGroup>
        <TextField
          id="kb-url"
          name="url"
          label="Dirección de la página"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.tunegocio.es/servicios"
          maxLength={2000}
          errors={errors?.url}
          help="Una página pública de tu web. Se guarda su texto, sin menús ni pies de página."
        />
        <div className="flex items-start gap-3">
          <Checkbox id="kb-url-sitemap" checked={sitemap} onCheckedChange={(next) => setSitemap(next === true)} aria-describedby="kb-url-sitemap-help" className="mt-0.5" />
          <div className="grid gap-1">
            <label htmlFor="kb-url-sitemap" className="text-sm font-medium">
              Añadir también las páginas de su mapa del sitio
            </label>
            <FieldDescription id="kb-url-sitemap-help">
              Lee el sitemap.xml de la web y añade hasta {SITEMAP_MAX_PAGES} páginas de ese mismo sitio, en segundo plano.
            </FieldDescription>
          </div>
        </div>
        <div className="grid gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <label htmlFor="kb-url-refresh" className="text-sm font-medium">
                Volver a leerla de vez en cuando
              </label>
              <FieldDescription id="kb-url-refresh-help">Si ha cambiado, se procesa de nuevo; si no, se deja como está.</FieldDescription>
            </div>
            <Switch id="kb-url-refresh" checked={refresh} onCheckedChange={setRefresh} aria-describedby="kb-url-refresh-help" className="mt-0.5" />
          </div>
          {refresh ? (
            <Select value={intervalHours} onValueChange={setIntervalHours}>
              <SelectTrigger aria-label="Cada cuánto se vuelve a leer" className="w-full sm:w-56" aria-invalid={errors?.refreshIntervalHours ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option.hours} value={String(option.hours)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Añadiendo…" : "Añadir página"}
        </Button>
      </div>
    </form>
  );
}
