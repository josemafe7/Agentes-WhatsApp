"use client";

import { Bot, Hand, LoaderCircle, Tag, UserPlus, X } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PersonRef } from "@/data/conversations";
import { CONVERSATION_STATUSES, type ConversationStatus } from "@/lib/enums";
import { labelSchema, MAX_LABELS } from "@/lib/validation";
import { assignAction, handOffAction, setAgentAction, setLabelsAction, setStatusAction, takeAction } from "../actions";
import { STATUS_META } from "../_lib/presentation";
import { useInboxAction } from "./use-inbox-action";

const NOBODY = "nobody";
const CHANNEL_AGENT = "channel";

// ─── Status ([BAN-12], [TRA-08]) ────────────────────────────────────────────────────────────────────────

export function StatusControl({ conversationId, status, canChange }: { conversationId: string; status: ConversationStatus; canChange: boolean }) {
  const id = useId();
  const { pending, run } = useInboxAction();
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  if (!canChange) {
    return (
      <span className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium ${meta.pill}`}>
        <Icon aria-hidden className="size-3" />
        {meta.label}
      </span>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Label htmlFor={`${id}-estado`} className="sr-only">
        Estado
      </Label>
      <Select value={status} onValueChange={(value) => run(() => setStatusAction({ conversationId, status: value }))} disabled={pending}>
        <SelectTrigger id={`${id}-estado`} className="min-w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONVERSATION_STATUSES.map((value) => {
            const item = STATUS_META[value];
            const ItemIcon = item.icon;
            return (
              <SelectItem key={value} value={value}>
                <ItemIcon aria-hidden className={item.className} />
                {item.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Manual hand-off ([TRA-01]–[TRA-03]) ────────────────────────────────────────────────────────────────

export function HandoffButton({ conversationId }: { conversationId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [urgency, setUrgency] = useState<"normal" | "high">("normal");
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useInboxAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setError("Escribe el motivo.");
      return;
    }
    setError(null);
    run(() => handOffAction({ conversationId, reason: reason.trim(), summary: summary.trim() || undefined, urgency }), {
      onSuccess: () => {
        setOpen(false);
        setReason("");
        setSummary("");
        setUrgency("normal");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="shrink-0">
          <Hand aria-hidden />
          Pasar a una persona
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>¿Pasar la conversación a una persona?</DialogTitle>
            <DialogDescription>
              Quedará «Pendiente de humano», la IA dejará de responder y el cliente recibirá el mensaje de traspaso del agente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-motivo`}>Motivo</Label>
            <Input
              id={`${id}-motivo`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-motivo-error` : undefined}
              placeholder="Por ejemplo: quiere hablar con la encargada"
            />
            {error ? (
              <p id={`${id}-motivo-error`} className="text-xs text-destructive-text">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-resumen`}>Resumen (opcional)</Label>
            <Textarea id={`${id}-resumen`} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1_000} rows={3} />
          </div>
          <div className="flex flex-col gap-2">
            <span id={`${id}-urgencia`} className="text-sm font-medium">
              Urgencia
            </span>
            <RadioGroup value={urgency} onValueChange={(value) => setUrgency(value === "high" ? "high" : "normal")} aria-labelledby={`${id}-urgencia`} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-normal`} value="normal" />
                <Label htmlFor={`${id}-normal`} className="font-normal">
                  Normal
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-alta`} value="high" />
                <Label htmlFor={`${id}-alta`} className="font-normal">
                  Urgente
                </Label>
              </div>
            </RadioGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              Pasar a una persona
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Assignment ([TRA-04]) ──────────────────────────────────────────────────────────────────────────────

type AssignControlProps = {
  conversationId: string;
  assignedUser: PersonRef | null;
  assignable: PersonRef[];
  userId: string;
  canAssign: boolean;
  canClaim: boolean;
};

/** Anyone who may assign chooses a person; an Agent only takes an unassigned conversation for themselves. */
export function AssignControl({ conversationId, assignedUser, assignable, userId, canAssign, canClaim }: AssignControlProps) {
  const id = useId();
  const { pending, run } = useInboxAction();
  const nameOf = (person: PersonRef) => (person.id === userId ? `${person.name} (tú)` : person.name);

  if (canAssign) {
    const options = assignedUser && !assignable.some((person) => person.id === assignedUser.id) ? [assignedUser, ...assignable] : assignable;
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Label htmlFor={`${id}-asignar`} className="text-sm text-muted-foreground">
          Asignada a
        </Label>
        <Select value={assignedUser?.id ?? NOBODY} onValueChange={(value) => run(() => assignAction({ conversationId, userId: value === NOBODY ? null : value }))} disabled={pending}>
          <SelectTrigger id={`${id}-asignar`} className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>Sin asignar</SelectItem>
            {options.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {nameOf(person)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (!assignedUser && canClaim) {
    return (
      <Button type="button" variant="outline" className="shrink-0" onClick={() => run(() => takeAction({ conversationId }), { success: "Ahora la atiendes tú." })} disabled={pending}>
        {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <UserPlus aria-hidden />}
        Tomar
      </Button>
    );
  }
  return (
    <span className="shrink-0 text-sm text-muted-foreground">
      {assignedUser ? (assignedUser.id === userId ? "Asignada a ti" : `Asignada a ${assignedUser.name}`) : "Sin asignar"}
    </span>
  );
}

// ─── Agent of this conversation ([AGE-14]) ──────────────────────────────────────────────────────────────

type AgentControlProps = {
  conversationId: string;
  agent: PersonRef | null;
  agentOverride: PersonRef | null;
  channelAgent: PersonRef | null;
  agents: PersonRef[];
  canChange: boolean;
};

export function AgentControl({ conversationId, agent, agentOverride, channelAgent, agents, canChange }: AgentControlProps) {
  const id = useId();
  const { pending, run } = useInboxAction();
  if (!canChange) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
        <Bot aria-hidden className="size-4 text-ai" />
        {agent ? `Agente: ${agent.name}` : "Sin agente de IA"}
      </span>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Label htmlFor={`${id}-agente`} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Bot aria-hidden className="size-4 text-ai" />
        Agente
      </Label>
      <Select
        value={agentOverride?.id ?? CHANNEL_AGENT}
        onValueChange={(value) =>
          run(() => setAgentAction({ conversationId, agentId: value === CHANNEL_AGENT ? null : value }), {
            success: value === CHANNEL_AGENT ? "Responde el agente del canal." : "A partir de ahora responde este agente en esta conversación.",
          })
        }
        disabled={pending}
      >
        <SelectTrigger id={`${id}-agente`} className="min-w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CHANNEL_AGENT}>{channelAgent ? `El del canal (${channelAgent.name})` : "El del canal (ninguno)"}</SelectItem>
          {agents.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Labels ([BAN-12]) ──────────────────────────────────────────────────────────────────────────────────

export function LabelsControl({ conversationId, labels, canChange }: { conversationId: string; labels: string[]; canChange: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useInboxAction();

  const save = (next: string[]) => run(() => setLabelsAction({ conversationId, labels: next }));

  function add() {
    const parsed = labelSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Escribe la etiqueta.");
      return;
    }
    if (labels.length >= MAX_LABELS) {
      setError(`Como mucho ${MAX_LABELS} etiquetas.`);
      return;
    }
    setError(null);
    setDraft("");
    if (!labels.includes(parsed.data)) save([...labels, parsed.data]);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  }

  const chips = (
    <ul aria-label="Etiquetas" className="flex flex-wrap items-center gap-1">
      {labels.map((label) => (
        <li key={label} className="inline-flex h-[22px] items-center rounded-full border px-2 text-xs">
          {label}
        </li>
      ))}
    </ul>
  );
  if (!canChange) return labels.length > 0 ? <div className="shrink-0">{chips}</div> : null;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {labels.length > 0 ? chips : null}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size={labels.length > 0 ? "icon" : "default"} aria-label="Editar etiquetas">
            <Tag aria-hidden />
            {labels.length > 0 ? null : "Etiquetas"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 gap-3 p-4">
          <Label htmlFor={`${id}-nueva`}>Etiquetas de la conversación</Label>
          {labels.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {labels.map((label) => (
                <li key={label} className="inline-flex h-6 items-center gap-1 rounded-full border pr-0.5 pl-2 text-xs">
                  {label}
                  <button
                    type="button"
                    onClick={() => save(labels.filter((item) => item !== label))}
                    disabled={pending}
                    aria-label={`Quitar la etiqueta ${label}`}
                    className="flex size-5 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input
              id={`${id}-nueva`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKey}
              maxLength={40}
              placeholder="Nueva etiqueta"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            <Button type="button" variant="outline" onClick={add} disabled={pending}>
              Añadir
            </Button>
          </div>
          {error ? (
            <p id={`${id}-error`} className="text-xs text-destructive-text">
              {error}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
