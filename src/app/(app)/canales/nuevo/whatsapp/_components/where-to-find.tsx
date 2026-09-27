"use client";

import { CircleQuestionMark } from "lucide-react";
import { HelpLink } from "@/components/help-link";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { FieldHelp } from "../_lib/help";

/**
 * «¿Dónde lo encuentro?» next to a label (DESIGN.md › Formularios, [WA-01]): a popover with 2–4 short steps and «Ver la
 * guía», which opens its section of the WhatsApp guide in Ayuda in a new tab (the wizard keeps what was typed).
 */
export function WhereToFind({ help }: { help: FieldHelp }) {
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1 rounded-sm text-xs font-normal text-primary-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        <CircleQuestionMark aria-hidden className="size-3.5" />
        ¿Dónde lo encuentro?
        <span className="sr-only"> ({help.title})</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>{help.title}</PopoverTitle>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            {help.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </PopoverHeader>
        <HelpLink href={help.href}>Ver la guía</HelpLink>
      </PopoverContent>
    </Popover>
  );
}
