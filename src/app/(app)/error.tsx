"use client";

import { RotateCw } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

type ErrorPageProps = { error: Error & { digest?: string }; retry: () => void };

/**
 * Unexpected error inside the app: the menus stay, the page shows a generic message with «Reintentar» and never
 * technical details ([SEG-14], DESIGN.md «Estados de pantalla»).
 */
export default function AppErrorPage({ retry }: ErrorPageProps) {
  return (
    <div className="max-w-xl">
      <ErrorState
        title="No se ha podido cargar esta página"
        description="Vuelve a intentarlo en unos segundos. Si sigue fallando, avisa al propietario."
        retry={
          <Button variant="outline" onClick={retry}>
            <RotateCw aria-hidden />
            Reintentar
          </Button>
        }
      />
    </div>
  );
}
