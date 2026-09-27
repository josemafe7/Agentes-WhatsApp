"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GRAPH_API_VERSIONS } from "@/lib/meta/versions";
import { changeWhatsAppApiVersionAction } from "./actions";

/** «Versión de la API de Meta» ([WA-49]): every call of the number uses it; a new one is kept only after revalidating. */
export function ApiVersionForm({ channelId, current }: { channelId: string; current: string }) {
  const [version, setVersion] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectId = useId();
  const errorId = useId();
  const versions = GRAPH_API_VERSIONS.some((entry) => entry.version === current) ? GRAPH_API_VERSIONS.map((entry) => entry.version) : [current, ...GRAPH_API_VERSIONS.map((entry) => entry.version)];

  function save() {
    startTransition(async () => {
      const result = await changeWhatsAppApiVersionAction(channelId, { graphApiVersion: version });
      if (!result.ok) {
        setError(result.fieldErrors?.graphApiVersion?.[0] ?? result.error);
        return;
      }
      setError(null);
      toast.success(result.message ?? "Versión cambiada.");
      for (const warning of result.data?.warnings ?? []) toast.warning(warning);
    });
  }

  return (
    <div className="grid gap-2">
      <label htmlFor={selectId} className="text-sm font-medium">
        Versión de la API de Meta
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={version} onValueChange={setVersion}>
          <SelectTrigger id={selectId} className="w-36" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={pending || version === current} aria-busy={pending} onClick={save}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Revalidando…" : "Cambiar y revalidar"}
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Todas las llamadas a Meta de este número usan esta versión. Solo se cambia si Meta valida el número con ella.</p>
      )}
    </div>
  );
}
