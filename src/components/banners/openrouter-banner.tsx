import { KeyRound } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Settings › IA, where the OpenRouter key is set. */
export const AI_SETTINGS_HREF = "/ajustes/ia";

type OpenRouterBannerProps = {
  /** "manage": owner or admin, with the button to Settings › IA; "ask": the other roles. */
  variant: "manage" | "ask";
};

/**
 * «Añade tu clave de OpenRouter»: on every page while the AI has no key; cannot be closed ([ARR-14],
 * DESIGN.md «Avisos»). Only roles that can open the keys get the button ([PER-04]).
 */
export function OpenRouterBanner({ variant }: OpenRouterBannerProps) {
  return (
    <Alert role="note" className="mb-6 gap-y-1 border-warning/30 bg-warning-soft px-4 py-3 text-foreground">
      <KeyRound aria-hidden className="text-warning" />
      <AlertTitle className="font-semibold">Añade tu clave de OpenRouter</AlertTitle>
      <AlertDescription className="text-foreground">
        <p>
          La IA está desactivada: los agentes no responden y la búsqueda de conocimiento va solo por texto.
          {variant === "ask" ? " Pide al propietario que la añada." : null}
        </p>
        {variant === "manage" ? (
          <div>
            <Button asChild>
              <Link href={AI_SETTINGS_HREF}>Añadir clave</Link>
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
