import { CircleAlert, CircleCheck } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";

type FormMessageProps = { result?: ActionResult<unknown> };

/** Result line of a Server Action under a form: its message on success, its generic error on failure. */
export function FormMessage({ result }: FormMessageProps) {
  if (!result) return null;

  if (result.ok) {
    if (!result.message) return null;
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-success">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {result.message}
      </p>
    );
  }

  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-destructive-text">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      {result.error}
    </p>
  );
}
