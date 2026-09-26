import type { ReactNode } from "react";

export type ReadOnlyItem = { label: string; value: ReactNode };

/** Read-only view of a tab (supervisor and viewer): the form as a list of data (DESIGN.md «Sin permiso»). */
export function ReadOnlyList({ items }: { items: ReadOnlyItem[] }) {
  return (
    <dl className="grid max-w-2xl gap-5">
      {items.map((item) => (
        <div key={item.label} className="grid gap-1">
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="text-sm break-words whitespace-pre-wrap">{isEmpty(item.value) ? "—" : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}
