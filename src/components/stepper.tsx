import { Check } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type StepperStep = { id: string; label: string };

type StepperProps = { steps: StepperStep[]; current: string };

const FULL_PROGRESS = 100;

/** Wizard progress: numbered steps in a row on desktop, «Paso 2 de 5 · Webhook» with a bar on mobile. */
export function Stepper({ steps, current }: StepperProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === current),
  );
  const currentStep = steps[currentIndex];
  const progress = steps.length > 0 ? ((currentIndex + 1) / steps.length) * FULL_PROGRESS : 0;

  return (
    <nav aria-label="Progreso">
      <div className="space-y-2 md:hidden">
        <p className="text-sm font-medium">
          Paso {currentIndex + 1} de {steps.length}
          {currentStep ? ` · ${currentStep.label}` : ""}
        </p>
        <Progress value={progress} aria-label="Progreso del asistente" />
      </div>
      <ol className="hidden items-center gap-2 md:flex">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={step.id} className="flex min-w-0 items-center gap-2" aria-current={active ? "step" : undefined}>
              {index > 0 ? <span aria-hidden className="h-px w-6 shrink-0 bg-border lg:w-10" /> : null}
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-2 border-primary text-primary-text",
                  !done && !active && "border-input text-muted-foreground",
                )}
              >
                {done ? <Check aria-hidden className="size-4" /> : index + 1}
              </span>
              <span
                className={cn(
                  "truncate text-sm",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
                {done ? <span className="sr-only"> (hecho)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
