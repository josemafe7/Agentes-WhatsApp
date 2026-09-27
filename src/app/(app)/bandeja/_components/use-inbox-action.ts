"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { requestRealtimePoll } from "@/hooks/use-realtime";
import type { ActionResult } from "@/lib/action-result";

export const ACTION_FAILED = "No se ha podido completar. Inténtalo de nuevo.";

/**
 * Runs an inbox Server Action: the button waits, errors come back as a toast in Spanish that stays until closed,
 * and the list and other screens ask for news at once. The action itself refreshes the conversation.
 */
export function useInboxAction() {
  const [pending, startTransition] = useTransition();

  function run<T>(action: () => Promise<ActionResult<T>>, options: { onSuccess?: (data: T | undefined) => void; success?: string } = {}) {
    startTransition(async () => {
      let result: ActionResult<T> | null;
      try {
        result = await action();
      } catch {
        result = null;
      }
      if (!result?.ok) {
        toast.error(result?.error ?? ACTION_FAILED, { duration: Infinity });
        return;
      }
      const message = options.success ?? result.message;
      if (message) toast.success(message);
      requestRealtimePoll();
      options.onSuccess?.(result.data);
    });
  }

  return { pending, run };
}
