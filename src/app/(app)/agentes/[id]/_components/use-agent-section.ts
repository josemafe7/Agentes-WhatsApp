"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAgentAction } from "../actions";

export type AgentSection<T> = {
  values: T;
  /** Changes one field of the tab. */
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  /** Replaces several fields at once (e.g. a generated draft). */
  merge: (partial: Partial<T>) => void;
  dirty: boolean;
  pending: boolean;
  save: () => void;
  discard: () => void;
  /** Generic message of the last failed save. */
  error?: string;
  /** Messages of a field by its path («instructions.role»), including those of its items («handoff.keywords.2»). */
  errorsFor: (path: string) => string[] | undefined;
};

/**
 * State of one editor tab: the values as typed (never cleared on errors), whether they differ from what is saved,
 * and saving them as a new version ([AGE-12]). The page re-mounts the tab with `key={currentVersion}` after a save.
 */
export function useAgentSection<T>(agentId: string, initial: T, toInput: (values: T) => Record<string, unknown>): AgentSection<T> {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [failure, setFailure] = useState<{ error: string; fieldErrors?: Record<string, string[]> } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  function save() {
    // Enter in a field submits the form: without changes there is no new version to save.
    if (pending || !dirty) return;
    startTransition(async () => {
      const result = await saveAgentAction(agentId, toInput(values));
      if (!result.ok) {
        setFailure({ error: result.error, fieldErrors: result.fieldErrors });
        return;
      }
      setFailure(null);
      setSaved(values);
      toast.success(result.message ?? "Cambios guardados.");
      router.refresh();
    });
  }

  function errorsFor(path: string): string[] | undefined {
    const fieldErrors = failure?.fieldErrors;
    if (!fieldErrors) return undefined;
    const messages = Object.entries(fieldErrors)
      .filter(([key]) => key === path || key.startsWith(`${path}.`))
      .flatMap(([, list]) => list);
    return messages.length > 0 ? [...new Set(messages)] : undefined;
  }

  return {
    values,
    set: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    merge: (partial) => setValues((current) => ({ ...current, ...partial })),
    dirty,
    pending,
    save,
    discard: () => {
      setValues(saved);
      setFailure(null);
    },
    error: failure?.error,
    errorsFor,
  };
}
