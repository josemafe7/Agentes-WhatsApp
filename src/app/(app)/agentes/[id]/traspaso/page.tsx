import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { listUsers } from "@/data/users";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { COMMON_HANDOFF_MESSAGES } from "@/lib/sectors/common";
import { listToLines } from "../../_lib/lines";
import { HandoffForm, type HandoffValues, type NotifyOption } from "../_components/handoff-form";
import { ReadOnlyList } from "../_components/read-only";
import { loadEditorPage } from "../_lib/load";
import { HandoffSection } from "./_components/handoff-section";

export const metadata: Metadata = { title: "Traspaso del agente" };

type PageProps = { params: Promise<{ id: string }> };

/**
 * Traspaso ([AGE-09]) in three parts: when it hands over (keywords, «no lo sé», sensitive topics), what the customer
 * reads (messages in and out of hours) and who is told.
 */
export default async function AgentHandoffPage({ params }: PageProps) {
  const page = await loadEditorPage(params, "traspaso", "handoff");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent, canManage } = page;
  const handoff = agent.handoff;
  const chosen = handoff.notifyUserIds ?? [];

  if (!canManage) {
    return (
      <div className="grid max-w-2xl gap-8">
        <HandoffSection part="when">
          <ReadOnlyList
            items={[
              { label: "Palabras clave", value: (handoff.keywords ?? []).join(", ") },
              { label: "Número de «no lo sé»", value: handoff.unknownThreshold === undefined ? null : String(handoff.unknownThreshold) },
              { label: "Temas sensibles", value: (handoff.sensitiveTopics ?? []).join(", ") },
            ]}
          />
        </HandoffSection>
        <HandoffSection part="messages">
          <ReadOnlyList
            items={[
              { label: "Mensaje dentro de horario", value: handoff.messageInHours ?? COMMON_HANDOFF_MESSAGES.messageInHours },
              { label: "Mensaje fuera de horario", value: handoff.messageOffHours ?? COMMON_HANDOFF_MESSAGES.messageOffHours },
            ]}
          />
        </HandoffSection>
        <HandoffSection part="notify">
          <ReadOnlyList
            items={[
              {
                label: "A quién avisar",
                value: chosen.length === 0 ? "Quien diga Ajustes › Notificaciones" : `${chosen.length} ${chosen.length === 1 ? "persona elegida" : "personas elegidas"}`,
              },
            ]}
          />
        </HandoffSection>
      </div>
    );
  }

  // People who can attend a hand-off: active and not read-only. Owners and admins manage users, so they may list them.
  const people: NotifyOption[] = can(actor, PERMISSIONS.settings.users)
    ? (await listUsers(actor))
        .filter((user) => user.disabledAt === null && (user.role !== "viewer" || chosen.includes(user.id)))
        .map((user) => ({ id: user.id, name: user.name, roleLabel: ROLE_LABELS[user.role] }))
    : [];

  const initial: HandoffValues = {
    keywords: listToLines(handoff.keywords),
    unknownThreshold: handoff.unknownThreshold === undefined ? "" : String(handoff.unknownThreshold),
    sensitiveTopics: listToLines(handoff.sensitiveTopics),
    messageInHours: handoff.messageInHours ?? "",
    messageOffHours: handoff.messageOffHours ?? "",
    notifyUserIds: chosen,
  };
  return <HandoffForm key={JSON.stringify(initial)} agentId={agent.id} initial={initial} people={people} defaultMessages={COMMON_HANDOFF_MESSAGES} />;
}
