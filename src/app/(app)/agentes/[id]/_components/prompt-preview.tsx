"use client";

import { Lock, ScrollText } from "lucide-react";
import { useState, useTransition } from "react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ActionResult } from "@/lib/action-result";
import type { PromptSection, SimulatedChannel } from "@/server/ai/prompt";
import { previewAgentPromptAction } from "../actions";

const CHANNELS: { value: SimulatedChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Correo" },
  { value: "webchat", label: "Chat web" },
];

type PreviewDraft = { name?: string; language?: string; tone?: string; instructions?: Record<string, string> };

type PromptPreviewProps = {
  agentId: string;
  /** Unsaved values of the form: the preview shows what would be sent once saved. Omit to preview what is saved. */
  draft?: PreviewDraft;
};

/**
 * «Vista previa del prompt» ([AGE-06]): the whole text the model receives, in the order of [MOT-07], with the
 * platform rules first; they cannot be removed ([MOT-06]). Read-only, and no AI is called.
 */
export function PromptPreview({ agentId, draft }: PromptPreviewProps) {
  const [channel, setChannel] = useState<SimulatedChannel>("whatsapp");
  const [result, setResult] = useState<ActionResult<{ sections: PromptSection[] }> | null>(null);
  const [pending, startTransition] = useTransition();

  function load(next: SimulatedChannel) {
    startTransition(async () => {
      setResult(await previewAgentPromptAction({ agentId, channel: next, draft }));
    });
  }

  return (
    <Sheet
      onOpenChange={(open) => {
        if (open) load(channel);
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          <ScrollText aria-hidden />
          Vista previa del prompt
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-base font-semibold">Vista previa del prompt</SheetTitle>
          <SheetDescription>
            El texto completo que recibe el modelo antes de los últimos mensajes de la conversación, en este orden.
            {draft ? " Incluye los cambios que aún no has guardado." : null}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-6">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={channel}
            onValueChange={(value) => {
              const next = CHANNELS.find((option) => option.value === value)?.value;
              if (!next) return;
              setChannel(next);
              load(next);
            }}
            aria-label="Canal de la vista previa"
          >
            {CHANNELS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <PreviewBody result={result} pending={pending} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PreviewBody({ result, pending }: { result: ActionResult<{ sections: PromptSection[] }> | null; pending: boolean }) {
  if (pending || !result) {
    return (
      <div className="grid gap-3" aria-busy>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!result.ok || !result.data) {
    return <ErrorState title="No se ha podido preparar la vista previa" description={result.ok ? undefined : result.error} />;
  }
  return (
    <ol className="grid gap-4">
      {result.data.sections.map((section, index) => (
        <li key={section.key} className="rounded-xl border">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2">
            <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            <span className="text-sm font-medium">{section.title}</span>
            {section.key === "rules" ? (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock aria-hidden className="size-3" />
                Siempre delante; no se pueden quitar
              </span>
            ) : null}
            {section.key === "dynamic" ? <span className="ml-auto text-xs text-muted-foreground">Cambia en cada conversación</span> : null}
          </div>
          <p className="max-w-prose px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{section.content}</p>
        </li>
      ))}
    </ol>
  );
}
