import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type ErrorStateProps = {
  title?: string;
  description?: string;
  retry?: ReactNode;
};

/** Generic error in the block that failed (never technical details), with an optional «Reintentar» control. */
export function ErrorState({
  title = "No se ha podido cargar",
  description = "Vuelve a intentarlo en unos segundos.",
  retry,
}: ErrorStateProps) {
  return (
    <Alert className="border-destructive-text/30 bg-destructive-soft text-destructive-text">
      <CircleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-destructive-text">
        <p>{description}</p>
        {retry ? <div className="mt-3">{retry}</div> : null}
      </AlertDescription>
    </Alert>
  );
}
