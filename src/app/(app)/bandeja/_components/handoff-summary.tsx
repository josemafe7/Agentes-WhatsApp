"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The summary of a hand-off ([TRA-07]): its first lines and, when it is longer, «Ver todo». A long summary would
 * otherwise push the messages out of the screen, above all on a phone.
 */
export function HandoffSummary({ summary }: { summary: string }) {
  const text = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const element = text.current;
    if (!element) return;
    // Also when the column changes width: what fits in three lines changes with it.
    const observer = new ResizeObserver(() => setClipped(element.scrollHeight > element.clientHeight + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      <p ref={text} className={cn("whitespace-pre-wrap", expanded ? null : "line-clamp-3")}>
        <span className="text-muted-foreground">Resumen: </span>
        {summary}
      </p>
      {clipped || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-0.5 rounded-sm text-xs font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          {expanded ? "Ver menos" : "Ver todo"}
        </button>
      ) : null}
    </div>
  );
}
