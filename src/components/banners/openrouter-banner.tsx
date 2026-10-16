import { KeyRound } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Settings › IA, where the OpenRouter key is set. */
export const AI_SETTINGS_HREF = "/ajustes/ia";

type OpenRouterBannerProps = {
  /** "manage": owner or admin, with the button to Settings › IA; "ask": the other roles. */
  variant: "manage" | "ask";
};

/**
 * «Añade tu clave de OpenRouter»: on every page while the AI has no key; cannot be closed ([ARR-14],
 * DESIGN.md «Avisos»). Only roles that can open the keys get the button ([PER-04]). It is on every screen, so it
 * takes one line on a computer (title, what it means and the button) and, narrower, the button goes next to the
 * title instead of under the text. On a phone, inside a conversation of the inbox (which marks itself
 * `data-conversation`), it keeps the title and the button and leaves the rest of the screen to the messages.
 */
export function OpenRouterBanner({ variant }: OpenRouterBannerProps) {
  return (
    <div
      role="note"
      className="mb-6 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm lg:grid-cols-[auto_auto_1fr_auto] lg:items-start lg:gap-x-3"
    >
      <KeyRound aria-hidden className="size-4 text-warning lg:mt-0.5" />
      <p className="font-semibold">Añade tu clave de OpenRouter</p>
      <p className="col-span-3 row-start-2 max-md:[main:has([data-conversation])_&]:hidden lg:col-span-1 lg:col-start-3 lg:row-start-1">
        La IA está desactivada: los agentes no responden y la búsqueda de conocimiento va solo por texto.
        {variant === "ask" ? " Pide al propietario que la añada." : null}
      </p>
      {variant === "manage" ? (
        <Button asChild size="sm" className="col-start-3 row-start-1 lg:col-start-4 lg:self-center">
          <Link href={AI_SETTINGS_HREF}>Añadir clave</Link>
        </Button>
      ) : null}
    </div>
  );
}
