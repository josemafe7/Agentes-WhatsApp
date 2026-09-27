import type { ReactNode } from "react";
import { Suspense } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { listInboxChannels } from "@/data/channels";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { getActor } from "@/server/session";
import { ConversationList } from "./_components/conversation-list";
import { InboxShell } from "./_components/inbox-shell";
import { ListSkeleton } from "./_components/list-skeleton";

/**
 * Bandeja ([BAN-01]): the list stays on the left while conversations open on the right, so its filters and scroll
 * survive. Checks the permission on the server; each page checks it again with its record ([SEG-04]). Without a
 * session the app layout and the page send the person to /login, coming back here.
 */
export default async function InboxLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor || actor.twoFactorSetupRequired) return null;
  if (!can(actor, PERMISSIONS.inbox.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  const [channels, profile] = await Promise.all([listInboxChannels(actor), getBusinessProfile(actor)]);
  return (
    <InboxShell
      list={
        // The list reads its filters from the URL in the browser.
        <Suspense fallback={<ListSkeleton />}>
          <ConversationList
            channels={channels}
            timezone={profile.timezone}
            initialNow={new Date()}
            canConnectChannel={can(actor, PERMISSIONS.channels.manage)}
            canUseSimulator={can(actor, PERMISSIONS.settings.diagnostics)}
          />
        </Suspense>
      }
    >
      {children}
    </InboxShell>
  );
}
