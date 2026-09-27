import Link from "next/link";
import { pageHref, type PageSlice } from "../_lib/pagination";

/** «Anteriores · Página 2 de 3 · Siguientes» under a list of 25 per page; nothing when it fits in one. */
export function PageNav({ slice, path, label }: { slice: PageSlice; path: string; label: string }) {
  if (slice.pages <= 1) return null;
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
      {slice.page > 1 ? (
        <Link href={pageHref(path, slice.page - 1)} className="font-medium text-primary-text underline-offset-4 hover:underline">
          Anteriores
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground tabular-nums">
        Página {slice.page} de {slice.pages}
      </span>
      {slice.page < slice.pages ? (
        <Link href={pageHref(path, slice.page + 1)} className="font-medium text-primary-text underline-offset-4 hover:underline">
          Siguientes
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
