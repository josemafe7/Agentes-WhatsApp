"use client";
// The template dialog's «Anotar permiso» ([WA-61], [CTO-09]): when the customer lacks the permission a template needs,
// it is recorded here first, saying how they gave it; the server checks who may, and the template then may go.
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { requestRealtimePoll } from "@/hooks/use-realtime";
import { CONSENT_METHOD_LABELS, PERMISSION_LABELS } from "@/lib/consents";
import { CONSENT_METHODS, type ConsentMethod, type ContactPermission } from "@/lib/enums";
import { recordTemplatePermissionAction } from "./actions";

const PERSON_METHODS = CONSENT_METHODS.filter((method) => method !== "imported");

export function RecordPermission({ conversationId, permission }: { conversationId: string; permission: ContactPermission }) {
  const id = useId();
  const [method, setMethod] = useState<ConsentMethod | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function record() {
    startTransition(async () => {
      const result = await recordTemplatePermissionAction({ conversationId, permission, method, ...(note.trim() ? { note: note.trim() } : {}) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      toast.success(result.message ?? "Permiso anotado.");
      requestRealtimePoll();
    });
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Anotar el permiso «{PERMISSION_LABELS[permission]}»</p>
      <p className="text-xs text-muted-foreground">Solo si el cliente lo ha dado. Queda en sus consentimientos con quién lo anota, cuándo y cómo lo dio.</p>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-como`}>Cómo lo dio</Label>
        <Select value={method} onValueChange={(value) => setMethod(value as ConsentMethod)}>
          <SelectTrigger id={`${id}-como`}>
            <SelectValue placeholder="Elige cómo" />
          </SelectTrigger>
          <SelectContent>
            {PERSON_METHODS.map((value) => (
              <SelectItem key={value} value={value}>
                {CONSENT_METHOD_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-nota`}>Nota (opcional)</Label>
        <Textarea id={`${id}-nota`} rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="button" size="sm" variant="outline" onClick={record} disabled={pending || !method} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden />}
          Anotar permiso
        </Button>
      </div>
    </div>
  );
}
