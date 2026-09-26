"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LeaveGuard } from "./leave-guard";
import type { AgentSection } from "./use-agent-section";

type EditorFormProps<T> = {
  section: AgentSection<T>;
  children: ReactNode;
  className?: string;
};

/**
 * Form of one editor tab: fields, and while there are changes the fixed bar «Cambios sin guardar · Descartar ·
 * Guardar» (DESIGN.md «Barra de guardado»). Leaving with changes asks first.
 */
export function EditorForm<T>({ section, children, className }: EditorFormProps<T>) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        section.save();
      }}
      className={cn("grid max-w-2xl gap-6", className)}
    >
      {children}
      <UnsavedChangesBar dirty={section.dirty} pending={section.pending} error={section.error} onDiscard={section.discard} />
      <LeaveGuard dirty={section.dirty && !section.pending} />
    </form>
  );
}

type UnsavedChangesBarProps = { dirty: boolean; pending: boolean; error?: string; onDiscard: () => void };

/** Sticks to the bottom of the screen (above the bottom bar on mobile) while the tab has unsaved changes. */
export function UnsavedChangesBar({ dirty, pending, error, onDiscard }: UnsavedChangesBarProps) {
  if (!dirty && !pending) return null;
  return (
    <div
      role="region"
      aria-label="Cambios sin guardar"
      className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card p-3 shadow-lg md:bottom-4"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Cambios sin guardar</p>
        {error ? (
          <p role="alert" className="mt-0.5 flex items-center gap-1.5 text-sm text-destructive-text">
            <CircleAlert aria-hidden className="size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={pending}>
          Descartar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}
