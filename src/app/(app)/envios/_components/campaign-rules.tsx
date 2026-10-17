import { BookOpen, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The rules of envíos in a few lines, with the guide ([CUM-15], [ARR-23]); in a sector with health data, also choosing
 * by an ailment and WhatsApp's ban on promoting health products ([CUM-14]). Next to a form, as wide as it.
 */
export function CampaignRules({ healthData, className }: { healthData: boolean; className?: string }) {
  return (
    <aside aria-labelledby="normas-envios" className={cn("grid gap-2 rounded-xl border bg-muted/40 p-4 text-sm", className)}>
      <h2 id="normas-envios" className="font-semibold">
        Antes de enviar publicidad
      </h2>
      <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
        <li>Solo a quien la aceptó expresamente: el permiso «Novedades y publicidad» (LSSI art. 21).</li>
        <li>Cada mensaje deja darse de baja fácil y gratis; la app pone el botón o el enlace (art. 22).</li>
        <li>Que se vea que es publicidad y quién la envía y, si es una oferta o un descuento, sus condiciones (art. 20).</li>
      </ul>
      {healthData ? (
        <p className="flex items-start gap-2 text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Elegir a quién se envía por su dolencia (por ejemplo, con una etiqueta «lumbalgia») necesita su consentimiento explícito para eso (RGPD art. 9.2.a), y
            WhatsApp no deja promocionar productos sanitarios (vendas, órtesis), sí los servicios.
          </span>
        </p>
      ) : null}
      <p>
        <Link href="/ayuda/envios" className="inline-flex items-center gap-1 text-primary-text underline-offset-4 hover:underline">
          <BookOpen aria-hidden className="size-4" />
          Guía de envíos
        </Link>
      </p>
    </aside>
  );
}
