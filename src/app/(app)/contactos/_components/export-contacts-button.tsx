"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportContactsCsvAction } from "../actions";
import { saveTextFile } from "../_lib/download";
import type { ContactsFilter } from "../_lib/search-params";

/** «Exportar» of Contactos ([CTO-06]): every contact of the list with its search and filters, as CSV. */
export function ExportContactsButton({ filter }: { filter: Omit<ContactsFilter, "page"> }) {
  const [pending, startTransition] = useTransition();

  function exportList() {
    startTransition(async () => {
      const result = await exportContactsCsvAction(filter);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "No se ha podido exportar. Inténtalo de nuevo." : result.error);
        return;
      }
      saveTextFile(result.data);
      toast.success(result.message ?? "Contactos exportados.");
    });
  }

  return (
    <Button type="button" variant="outline" onClick={exportList} disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Download aria-hidden />}
      {pending ? "Exportando…" : "Exportar"}
    </Button>
  );
}
