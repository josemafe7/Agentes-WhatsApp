import { MessagesSquare, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listMyAssistants } from "@/data/assistants";
import { fileUrl } from "@/data/business";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { AgentAvatar } from "../agentes/_components/agent-avatar";
import { ASSISTANTS_PATH, assistantPath } from "./_lib/paths";

export const metadata: Metadata = { title: "Asistentes" };

/** Asistentes ([INT-06]): the internal agents this person may use. One they were not given never appears. */
export default async function AssistantsPage() {
  const actor = await requirePageActor({ next: ASSISTANTS_PATH });
  if (!can(actor, PERMISSIONS.internal.use)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const assistants = await listMyAssistants(actor);
  const canCreate = can(actor, PERMISSIONS.internal.agents);

  return (
    <>
      <PageHeader title="Asistentes" description="Agentes internos que responden a tu equipo con los documentos del negocio. Lo que preguntas solo lo ves tú." />
      {assistants.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={MessagesSquare}
            title={canCreate ? "Crea tu primer agente interno" : "Todavía no tienes asistentes"}
            description={
              canCreate
                ? "Un agente interno responde a tu equipo con los manuales y procedimientos que le des. Tú eliges quién puede usarlo."
                : "Cuando un administrador te dé acceso a un agente interno, aparecerá aquí."
            }
            action={
              canCreate ? (
                <Button asChild>
                  <Link href="/agentes/nuevo">
                    <Plus aria-hidden />
                    Nuevo agente
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {assistants.map((assistant) => (
            <li key={assistant.id} className="relative flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent">
              <AgentAvatar name={assistant.name} src={assistant.avatarFileKey ? fileUrl(assistant.avatarFileKey) : null} />
              <div className="grid min-w-0 gap-0.5">
                <h2 className="truncate text-base font-semibold">
                  {/* The whole card is the link. */}
                  <Link href={assistantPath(assistant.id)} className="outline-none after:absolute after:inset-0 after:rounded-xl">
                    {assistant.name}
                  </Link>
                </h2>
                <p className="line-clamp-2 text-sm text-muted-foreground">{assistant.description || "Pregúntale lo que necesites del negocio."}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
