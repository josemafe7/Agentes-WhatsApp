import { Coins } from "lucide-react";
import { messageCostText, messageCostView, type CostView, type MessagePricingInfo } from "./presentation";

const EXPLANATIONS: Record<CostView["kind"], string> = {
  estimated: "Coste estimado con la tarifa de Ajustes › WhatsApp para el país del cliente.",
  free: "Meta no cobra este mensaje.",
  not_estimated: "Meta lo cobra, pero no hay tarifa para el país del cliente en Ajustes › WhatsApp.",
};

/** The estimated cost and Meta's pricing category of a sent WhatsApp message ([WA-47]); nothing until Meta prices it. */
export function MessageCost({ pricing }: { pricing: MessagePricingInfo | null | undefined }) {
  const view = messageCostView(pricing);
  if (!view) return null;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title={EXPLANATIONS[view.kind]}>
      <Coins aria-hidden className="size-3.5" />
      <span className="sr-only">Coste de WhatsApp: </span>
      {messageCostText(view)}
    </span>
  );
}
