import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

type AuthCardProps = { title: string; description?: ReactNode; children: ReactNode };

/** Card of the screens without a session: the page's H1, one line of explanation and the form or message. */
export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}
