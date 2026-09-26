import { Info } from "lucide-react";

/**
 * «Modo demo» strip: 32 px, full width, at the very top, cannot be closed ([ARR-05], DESIGN.md «Avisos»).
 * On mobile only «Modo demo».
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Modo demo"
      className="sticky top-0 z-40 flex h-8 shrink-0 items-center justify-center gap-2 bg-info-soft px-4 text-xs text-info"
    >
      <Info aria-hidden className="size-4 shrink-0" />
      <p className="truncate">
        <span className="font-medium">Modo demo</span>
        <span className="hidden md:inline">
          {" "}
          · Datos de ejemplo. Los canales de demo no envían mensajes reales y los usuarios de prueba se pueden borrar.
        </span>
      </p>
    </div>
  );
}
