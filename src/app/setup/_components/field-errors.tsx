import { CircleAlert } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";

/** Messages of one field from a failed action, if any. */
export function fieldErrorsOf(result: ActionResult<unknown> | undefined, field: string): string[] {
  return result && !result.ok ? (result.fieldErrors?.[field] ?? []) : [];
}

type FieldErrorsProps = { id: string; messages: string[] };

/** Error under a field (DESIGN.md «Formularios»): destructive text with an icon, linked by aria-describedby. */
export function FieldErrors({ id, messages }: FieldErrorsProps) {
  if (messages.length === 0) return null;
  return (
    <div id={id} className="space-y-1">
      {messages.map((message) => (
        <p key={message} className="flex items-start gap-1.5 text-sm text-destructive-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {message}
        </p>
      ))}
    </div>
  );
}
