"use client";

import { RotateCw } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

type ErrorPageProps = { error: Error & { digest?: string }; retry: () => void };

/** Unexpected error outside the app shell: generic message and «Reintentar», never technical details ([SEG-14]). */
export default function ErrorPage({ retry }: ErrorPageProps) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 md:px-6">
      <div className="w-full max-w-md">
        <ErrorState
          title="Algo ha fallado"
          description="No se ha podido cargar esta página. Vuelve a intentarlo en unos segundos."
          retry={
            <Button variant="outline" onClick={retry}>
              <RotateCw aria-hidden />
              Reintentar
            </Button>
          }
        />
      </div>
    </main>
  );
}
