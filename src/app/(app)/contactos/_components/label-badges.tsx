import { Badge } from "@/components/ui/badge";

const SHOWN_IN_LISTS = 2;

/** Labels in lists: neutral outline badges, at most two and «+N» (DESIGN.md «Insignias»). */
export function LabelBadges({ labels, max = SHOWN_IN_LISTS }: { labels: readonly string[]; max?: number }) {
  if (labels.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = labels.slice(0, max);
  const hidden = labels.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((label) => (
        <Badge key={label} variant="outline" className="max-w-40">
          <span className="truncate">{label}</span>
        </Badge>
      ))}
      {hidden > 0 ? (
        <Badge variant="outline" title={labels.slice(max).join(", ")}>
          +{hidden}
        </Badge>
      ) : null}
    </span>
  );
}
