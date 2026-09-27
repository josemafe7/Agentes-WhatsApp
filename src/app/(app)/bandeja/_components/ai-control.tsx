"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { setAiAction } from "../actions";
import { AI_STATE_META, aiStateOf, formatUntil } from "../_lib/presentation";
import { useInboxAction } from "./use-inbox-action";
import { useNow } from "./use-now";

const HOUR_MS = 3_600_000;
const MAX_REASON = 300;
const PAUSE_CHOICES = [
  { value: "1", label: "1 hora", hours: 1 },
  { value: "4", label: "4 horas", hours: 4 },
  { value: "24", label: "24 horas", hours: 24 },
  { value: "off", label: "Hasta que alguien la reactive", hours: null },
] as const;
type PauseChoice = (typeof PAUSE_CHOICES)[number]["value"];

type AiControlProps = {
  conversationId: string;
  aiMode: "ai" | "human";
  aiPausedUntil: Date | null;
  pauseReason: string | null;
  canChange: boolean;
  timezone: string;
  initialNow: Date;
};

/**
 * The conversation's AI switch, always in sight with its reason while paused or off ([BAN-10], [BAN-11]):
 * «IA en pausa hasta 18:40 · Reactivar». Turning it off asks for how long and why.
 */
export function AiControl({ conversationId, aiMode, aiPausedUntil, pauseReason, canChange, timezone, initialNow }: AiControlProps) {
  const id = useId();
  const now = useNow(initialNow);
  const state = aiStateOf({ aiMode, aiPausedUntil }, now);
  const meta = AI_STATE_META[state.kind];
  const Icon = meta.icon;
  const { pending, run } = useInboxAction();
  const [dialogOpen, setDialogOpen] = useState(false);
  const label =
    state.kind === "ai" ? "La IA responde" : state.kind === "paused" ? `IA en pausa hasta ${formatUntil(state.until, timezone, now)}` : "IA apagada: atiende una persona";

  const reactivate = () => run(() => setAiAction({ conversationId, mode: "on" }), { success: "La IA vuelve a responder en esta conversación." });

  return (
    <div className="flex shrink-0 items-center gap-2">
      {canChange ? (
        <Switch
          id={`${id}-ia`}
          checked={state.kind === "ai"}
          disabled={pending}
          onCheckedChange={(checked) => (checked ? reactivate() : setDialogOpen(true))}
          aria-describedby={`${id}-estado`}
        />
      ) : null}
      <div className="flex min-w-0 flex-col">
        <label htmlFor={canChange ? `${id}-ia` : undefined} id={`${id}-estado`} className={cn("inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap", meta.className)}>
          <Icon aria-hidden className="size-4" />
          {label}
        </label>
        {state.kind !== "ai" && pauseReason ? <span className="max-w-64 truncate text-xs text-muted-foreground" title={pauseReason}>{pauseReason}</span> : null}
      </div>
      {canChange && state.kind !== "ai" ? (
        <Button type="button" variant="link" size="sm" className="px-1" onClick={reactivate} disabled={pending}>
          Reactivar
        </Button>
      ) : null}
      {canChange ? <PauseDialog open={dialogOpen} onOpenChange={setDialogOpen} conversationId={conversationId} timezone={timezone} /> : null}
    </div>
  );
}

function PauseDialog({ open, onOpenChange, conversationId, timezone }: { open: boolean; onOpenChange: (open: boolean) => void; conversationId: string; timezone: string }) {
  const id = useId();
  const [choice, setChoice] = useState<PauseChoice>("4");
  const [reason, setReason] = useState("");
  const { pending, run } = useInboxAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    const option = PAUSE_CHOICES.find((item) => item.value === choice);
    if (!option) return;
    const trimmed = reason.trim() || undefined;
    if (option.hours === null) {
      run(() => setAiAction({ conversationId, mode: "off", reason: trimmed }), { success: "IA apagada en esta conversación.", onSuccess: () => onOpenChange(false) });
      return;
    }
    const until = new Date(Date.now() + option.hours * HOUR_MS);
    run(() => setAiAction({ conversationId, mode: "pause", until: until.toISOString(), reason: trimmed }), {
      success: `IA en pausa hasta ${formatUntil(until, timezone, new Date())}.`,
      onSuccess: () => onOpenChange(false),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>¿Pausar la IA en esta conversación?</DialogTitle>
            <DialogDescription>Mientras tanto, la IA no responde aquí y los mensajes esperan a una persona.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={choice} onValueChange={(value) => setChoice(value as PauseChoice)} aria-label="Durante cuánto tiempo">
            {PAUSE_CHOICES.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-${option.value}`} value={option.value} />
                <Label htmlFor={`${id}-${option.value}`} className="font-normal">
                  {option.hours === null ? option.label : `Pausar ${option.label}`}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-motivo`}>Motivo (opcional)</Label>
            <Input id={`${id}-motivo`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={MAX_REASON} placeholder="Por ejemplo: lo llevo yo" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {choice === "off" ? "Apagar la IA" : "Pausar la IA"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
