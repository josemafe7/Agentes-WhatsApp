import { CircleQuestionMark } from "lucide-react";
import type { ReactNode } from "react";

type HelpLinkProps = { href: string; children?: ReactNode };

/** Small «¿Dónde lo encuentro?» link to a guide, opened in a new tab (for fields that ask for external data). */
export function HelpLink({ href, children = "¿Dónde lo encuentro?" }: HelpLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary-text underline-offset-4 hover:underline"
    >
      <CircleQuestionMark aria-hidden className="size-3.5" />
      {children}
      <span className="sr-only"> (se abre en una pestaña nueva)</span>
    </a>
  );
}
