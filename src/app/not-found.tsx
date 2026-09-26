import { SearchX } from "lucide-react";
import Link from "next/link";
import { INBOX_PATH } from "@/components/app-shell/home-destination";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

/** «Esta página no existe» (docs/pantallas.md «Elementos comunes»). */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 md:px-6">
      <EmptyState
        icon={SearchX}
        title="Esta página no existe"
        description="Puede que el enlace esté mal escrito o que la página ya no esté."
        action={
          <Button asChild>
            <Link href={INBOX_PATH}>Ir a la bandeja</Link>
          </Button>
        }
      />
    </main>
  );
}
