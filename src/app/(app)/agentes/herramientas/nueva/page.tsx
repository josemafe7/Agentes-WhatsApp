import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { HTTP_TOOL_LIMITS } from "@/server/ai/tools/http-tool-definition";
import { requirePageActor } from "@/server/session";
import { ToolForm } from "../_components/tool-form";
import { HTTP_TOOLS_PATH, NEW_HTTP_TOOL_PATH } from "../_lib/paths";

export const metadata: Metadata = { title: "Nueva herramienta HTTP" };

/** Nueva herramienta HTTP ([HER-11]); after creating it, its page opens to try it («Probar»). Owner and admin. */
export default async function NewHttpToolPage() {
  const actor = await requirePageActor({ next: NEW_HTTP_TOOL_PATH });
  if (!can(actor, PERMISSIONS.agents.customTools)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Agentes", href: "/agentes" }, { label: "Herramientas HTTP", href: HTTP_TOOLS_PATH }, { label: "Nueva" }]}
        title="Nueva herramienta HTTP"
        description="Qué hace, qué datos le pasa la IA y a qué dirección llama. Después podrás probarla y activarla en tus agentes."
      />
      <ToolForm
        tool={{
          id: null,
          name: "",
          description: "",
          method: "POST",
          url: "",
          timeoutSeconds: HTTP_TOOL_LIMITS.defaultTimeoutSeconds,
          parameters: [],
          headers: [],
          headersReadable: true,
        }}
      />
    </>
  );
}
