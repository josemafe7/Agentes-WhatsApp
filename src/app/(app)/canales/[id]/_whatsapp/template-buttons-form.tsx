"use client";
// What each quick-reply button of a template does ([AGD-32], [WA-62]): «Confirmo» and «Necesito cambiarla» of a
// reminder, or the baja of novedades y publicidad. Those created from the app come set; the synced ones, by hand.
import { LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TemplateButtonRole } from "@/lib/enums";
import { setTemplateButtonRolesAction } from "./actions";

const ROLE_LABELS: Record<TemplateButtonRole | "none", string> = {
  none: "Solo responde",
  confirm: "Confirmo (la cita)",
  change: "Necesito cambiarla",
  marketing_opt_out: "Baja de publicidad",
};

type TemplateButtonsFormProps = { templateId: string; buttons: string[]; roles: Record<string, TemplateButtonRole> };

export function TemplateButtonsForm({ templateId, buttons, roles }: TemplateButtonsFormProps) {
  const [chosen, setChosen] = useState<Record<string, TemplateButtonRole | null>>(() => Object.fromEntries(buttons.map((text) => [text, roles[text] ?? null])));
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await setTemplateButtonRolesAction({ templateId, roles: chosen });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Botones guardados.");
    });
  }

  return (
    <div className="grid gap-2 rounded-lg bg-muted/50 p-2">
      <p className="text-xs font-medium text-muted-foreground">Qué hace cada botón</p>
      {buttons.map((text) => (
        <div key={text} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">«{text}»</span>
          <Select value={chosen[text] ?? "none"} onValueChange={(value) => setChosen((current) => ({ ...current, [text]: value === "none" ? null : (value as TemplateButtonRole) }))}>
            <SelectTrigger className="h-8 w-48" aria-label={`Qué hace el botón «${text}»`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABELS) as (TemplateButtonRole | "none")[]).map((role) => (
                <SelectItem key={role} value={role}>
                  {ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          Guardar botones
        </Button>
      </div>
    </div>
  );
}
