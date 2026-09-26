import { Lock } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

type NoPermissionProps = { description?: string };

/** «No tienes permiso» screen for the content area; the server has already refused the data. */
export function NoPermission({
  description = "Tu rol no incluye esta sección. Si la necesitas, pídesela al propietario.",
}: NoPermissionProps) {
  return (
    <EmptyState
      icon={Lock}
      title="No tienes permiso para ver esta sección"
      description={description}
      action={
        <Button asChild variant="outline">
          <Link href="/bandeja">Ir a la bandeja</Link>
        </Button>
      }
    />
  );
}
