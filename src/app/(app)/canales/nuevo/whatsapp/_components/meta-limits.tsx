import { Gauge } from "lucide-react";
import { HelpLink } from "@/components/help-link";
import { guideHref } from "../_lib/help";

const TITLE = "Límites de Meta que conviene conocer";

function Limits() {
  return (
    <>
      <ul className="grid list-disc gap-2 pl-5 text-sm text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Límite de mensajes:</span> es del portfolio del negocio y lo comparten todos sus números.
          Cuenta los destinatarios distintos a los que escribes fuera de la ventana de atención en 24 horas (responder dentro de la ventana no
          cuenta). Empieza en 250 y sube a 2.000 (al verificar la empresa o al llegar a 2.000 con buena calidad), 10.000, 100.000 e ilimitado.
        </li>
        <li>
          <span className="font-medium text-foreground">Sin verificar la empresa:</span> como máximo 2 números por portfolio (20 al verificarla o
          al llegar a 2.000), y el nombre del negocio solo se ve en el perfil, no en la cabecera del chat, hasta que Meta lo aprueba.
        </li>
        <li>
          <span className="font-medium text-foreground">Apps de Meta:</span> como máximo 15 por persona mientras la empresa no esté verificada.
        </li>
        <li>
          <span className="font-medium text-foreground">Política de Meta:</span> desde el 15-01-2026 están prohibidos los asistentes de IA de
          propósito general. Tu agente solo atiende los temas de tu negocio.
        </li>
      </ul>
      <HelpLink href={guideHref("portfolio")}>Más sobre los límites en la guía</HelpLink>
    </>
  );
}

/**
 * Meta's limits ([WA-30], docs/integracion-whatsapp.md §8, §10). The wizard shows them whole, before the number is
 * connected; the panel of a number keeps them folded (`folded`): there they are reference, read once in a while, and
 * the limit that matters day to day is already one of the number's traffic lights.
 */
export function MetaLimits({ folded = false }: { folded?: boolean }) {
  if (folded) {
    return (
      <section aria-labelledby="meta-limits-title">
        <details className="rounded-xl border bg-card">
          <summary className="cursor-pointer rounded-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <h2 id="meta-limits-title" className="inline text-base font-semibold">
              {TITLE}
            </h2>
          </summary>
          <div className="grid gap-3 border-t p-4">
            <Limits />
          </div>
        </details>
      </section>
    );
  }
  return (
    <section aria-labelledby="meta-limits-title" className="grid gap-3 rounded-xl border bg-card p-4 sm:p-6">
      <h2 id="meta-limits-title" className="flex items-center gap-2 text-base font-semibold">
        <Gauge aria-hidden className="size-4 text-muted-foreground" />
        {TITLE}
      </h2>
      <Limits />
    </section>
  );
}
