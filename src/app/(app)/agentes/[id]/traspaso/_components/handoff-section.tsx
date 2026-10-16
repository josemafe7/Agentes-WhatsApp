import type { ReactNode } from "react";

/** The three parts of the Traspaso tab ([AGE-09]), the same for who edits it and for who only reads it. */
const HANDOFF_SECTIONS = {
  when: "Cuándo pasa a una persona",
  messages: "Qué le dice al cliente",
  notify: "A quién se avisa",
} as const;

/** One part of the tab under its title. */
export function HandoffSection({ part, children }: { part: keyof typeof HANDOFF_SECTIONS; children: ReactNode }) {
  const headingId = `handoff-${part}-heading`;
  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <h2 id={headingId} className="text-base font-semibold">
        {HANDOFF_SECTIONS[part]}
      </h2>
      {children}
    </section>
  );
}
