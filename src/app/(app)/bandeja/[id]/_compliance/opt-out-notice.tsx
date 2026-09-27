import { BellOff } from "lucide-react";
import { OPTED_OUT_COMPOSER_WARNING } from "@/server/compliance/opt-out";

/**
 * Over the composer when the customer opted out of this channel ([CUM-03], [CUM-04]): a person may still write to them,
 * knowing that the AI, the reminders and the templates are stopped.
 */
export function OptOutNotice() {
  return (
    <p role="status" className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
      <BellOff aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{OPTED_OUT_COMPOSER_WARNING}</span>
    </p>
  );
}
