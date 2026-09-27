import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { ChannelStatusBadge } from "../_components/channel-status-badge";
import { CHANNEL_TABS, channelPath } from "../_lib/webchat";
import { ChannelTabs } from "./_components/channel-tabs";
import { loadChannelPage } from "./_lib/load";

type ChannelLayoutProps = { children: ReactNode; params: Promise<{ id: string }> };

/**
 * Panel del canal (docs/pantallas.md): header and one tab per route. «Apariencia y código» only for web chats; other
 * types add their tabs in their phase. Solo lectura sees it without actions and never credentials ([PER-03]); each
 * tab checks the permission again on the server ([SEG-04]).
 */
export default async function ChannelLayout({ children, params }: ChannelLayoutProps) {
  const page = await loadChannelPage(params);
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { channel, canManage } = page;
  const identity = CHANNEL_IDENTITY[channel.type];

  const tabs = CHANNEL_TABS.filter((tab) => tab.key !== "appearance" || channel.type === "webchat").map((tab) => ({
    key: tab.key,
    label: tab.label,
    href: channelPath(channel.id, tab.segment),
  }));

  return (
    <div className="flex flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Canales", href: "/canales" }, { label: channel.name }]}
        title={channel.name}
        description={channel.isDemo ? `${identity.label} · Demo: no envía mensajes reales.` : identity.label}
        actions={
          <>
            <ChannelStatusBadge status={channel.status} />
            {canManage ? null : (
              <Badge variant="outline" className="h-[22px] gap-1">
                <Eye aria-hidden />
                Solo lectura
              </Badge>
            )}
          </>
        }
      />
      <ChannelTabs tabs={tabs} baseHref={channelPath(channel.id)} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
