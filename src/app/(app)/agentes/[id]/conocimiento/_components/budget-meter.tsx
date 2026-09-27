import { CircleAlert, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { formatCurrencyUSD, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { budgetPercent, type BudgetLevel } from "../_lib/view";

type BudgetMeterProps = {
  totalTokens: number;
  maxTokens: number;
  level: BudgetLevel;
  /** Input price of the agent's model applied to these tokens; null amount when the price is unknown. */
  cost: { modelId: string; perMessage: number | null };
  /** «Pasar a una base de conocimiento» is in each file's menu (owner and admin). */
  canMove: boolean;
};

/**
 * Size of the context files against the 30,000-token cap ([CON-02]). Close to the cap it warns of the cost per
 * message and suggests a knowledge base; at the cap, that nothing more can be added.
 */
export function BudgetMeter({ totalTokens, maxTokens, level, cost, canMove }: BudgetMeterProps) {
  const amount = cost.perMessage !== null && cost.perMessage > 0 ? formatCurrencyUSD(cost.perMessage) : null;
  const sendsLine = `Cada respuesta del agente envía estos ${formatNumber(totalTokens)} tokens al modelo${
    amount ? `: unos ${amount} por mensaje con ${cost.modelId} (aproximado).` : ", y se pagan en cada mensaje."
  }`;
  const where = canMove ? " (en el menú de cada archivo)" : "";

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span id="context-budget-label" className="font-medium">
            Tamaño de los archivos de contexto
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatNumber(totalTokens)} de {formatNumber(maxTokens)} tokens
          </span>
        </div>
        <Progress
          value={budgetPercent(totalTokens, maxTokens)}
          aria-labelledby="context-budget-label"
          aria-valuetext={`${formatNumber(totalTokens)} de ${formatNumber(maxTokens)} tokens`}
          className={cn(
            "h-2",
            level === "warning" && "[&>[data-slot=progress-indicator]]:bg-warning",
            level === "full" && "[&>[data-slot=progress-indicator]]:bg-destructive",
          )}
        />
      </div>
      {level === "warning" ? (
        <Alert role="status" className="border-warning/30 bg-warning-soft">
          <TriangleAlert aria-hidden className="text-warning" />
          <AlertTitle>Los archivos de contexto se acercan al tope</AlertTitle>
          <AlertDescription>
            <p>{sendsLine}</p>
            <p>Si van a crecer, pásalos a una base de conocimiento{where}: el agente buscará en ellos solo lo que necesite.</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {level === "full" ? (
        <Alert role="status" className="border-destructive/30 bg-destructive-soft">
          <CircleAlert aria-hidden className="text-destructive-text" />
          <AlertTitle>Has llegado al tope de {formatNumber(maxTokens)} tokens</AlertTitle>
          <AlertDescription>
            <p>{sendsLine}</p>
            <p>No se pueden añadir más archivos de contexto. Recorta alguno o pásalo a una base de conocimiento{where}.</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
