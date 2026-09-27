// Possible duplicates ([CTO-04]): pairs of contacts that may be the same person and why. The app only points them
// out; «Revisar y fusionar» opens the merge, where a person decides ([CTO-05]). Server component.
import { GitMerge } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContactBrief, DuplicateSuggestion } from "@/data/contacts-merge";
import type { DuplicateReason } from "@/data/contacts-merge-plan";
import { contactPath, mergePath } from "../_lib/search-params";

export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  email: "Mismo email",
  phone: "Mismo teléfono",
  name: "Mismo nombre",
};

function ContactLine({ contact }: { contact: ContactBrief }) {
  const detail = [contact.email, contact.phone].filter((value): value is string => Boolean(value) && value !== contact.displayName).join(" · ");
  return (
    <span className="grid min-w-0">
      <Link href={contactPath(contact.id)} className="truncate font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        {contact.displayName}
      </Link>
      {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
    </span>
  );
}

function Reasons({ reasons }: { reasons: DuplicateReason[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <Badge key={reason} variant="outline">
          {DUPLICATE_REASON_LABELS[reason]}
        </Badge>
      ))}
    </span>
  );
}

function ReviewLink({ suggestion }: { suggestion: DuplicateSuggestion }) {
  const [one, other] = suggestion.contacts;
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={mergePath(one.id, other.id)}>
        <GitMerge aria-hidden />
        Revisar y fusionar
      </Link>
    </Button>
  );
}

/** «Posibles duplicados» page: both contacts of each pair. */
export function DuplicatePairs({ suggestions }: { suggestions: DuplicateSuggestion[] }) {
  return (
    <ul className="divide-y rounded-xl border">
      {suggestions.map((suggestion) => {
        const [one, other] = suggestion.contacts;
        return (
          <li key={`${one.id}-${other.id}`} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
            <ContactLine contact={one} />
            <ContactLine contact={other} />
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              <Reasons reasons={suggestion.reasons} />
              <ReviewLink suggestion={suggestion} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The card's «Posibles duplicados»: the other contact of each pair of this one. */
export function DuplicatesOf({ contactId, suggestions }: { contactId: string; suggestions: DuplicateSuggestion[] }) {
  return (
    <ul className="grid gap-4">
      {suggestions.map((suggestion) => {
        const other = suggestion.contacts[0].id === contactId ? suggestion.contacts[1] : suggestion.contacts[0];
        return (
          <li key={other.id} className="grid gap-2 text-sm">
            <ContactLine contact={other} />
            <Reasons reasons={suggestion.reasons} />
            <div>
              <ReviewLink suggestion={suggestion} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
