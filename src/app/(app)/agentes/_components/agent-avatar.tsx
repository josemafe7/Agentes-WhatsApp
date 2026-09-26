import { cn } from "@/lib/utils";
import { agentInitials } from "../_lib/labels";

type AgentAvatarProps = { name: string; src: string | null; className?: string };

/** Avatar of an agent: its image (served by /api/files with permission) or its initials on --ai-soft (DESIGN.md). */
export function AgentAvatar({ name, src, className }: AgentAvatarProps) {
  return (
    <span
      aria-hidden
      className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ai-soft text-sm font-semibold text-ai", className)}
    >
      {src ? (
        // Private file behind the authenticated route; the key changes on every upload.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        agentInitials(name)
      )}
    </span>
  );
}
