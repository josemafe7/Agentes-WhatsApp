"use client";

import { GitMerge } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { MergePreview, MergeSide } from "@/data/contacts-merge";
import type { FieldChoice, FieldChoices, MergeField } from "@/data/contacts-merge-plan";
import { formatDateTime, formatNumber } from "@/lib/format";
import { mergeContactsAction } from "../../actions";
import { ChannelName } from "../../_components/channel-icons";
import { contactPath, CONTACTS_PATH } from "../../_lib/search-params";

const FIELD_LABELS: Record<MergeField, string> = { name: "Nombre", phone: "Teléfono", email: "Email", notes: "Notas" };
const FIELDS: MergeField[] = ["name", "phone", "email", "notes"];

type MergeFormProps = {
  /** The two directions: the first contact kept, and the second one kept. */
  previews: [MergePreview, MergePreview];
  defaultKeepId: string;
  timezone: string;
  /** «Citas» or «Reservas» ([AGD-01]). */
  bookingsLabel: string;
};

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

function SideSummary({ side, timezone, bookingsLabel }: { side: MergeSide; timezone: string; bookingsLabel: string }) {
  return (
    <span className="grid min-w-0 gap-0.5 text-sm">
      <span className="truncate font-medium">{side.displayName}</span>
      {[side.email, side.phone]
        .filter((value): value is string => Boolean(value) && value !== side.displayName)
        .map((value) => (
          <span key={value} className="truncate text-muted-foreground">
            {value}
          </span>
        ))}
      <span className="text-xs text-muted-foreground">
        Contacto desde el {formatDateTime(side.createdAt, timezone, { preset: "date" })} · {plural(side.conversations.length, "conversación", "conversaciones")} ·{" "}
        {bookingsLabel}: {formatNumber(side.bookings)}
      </span>
    </span>
  );
}

function valueOf(field: MergeField, choice: FieldChoice, keep: MergeSide, merge: MergeSide): string | null {
  if (choice === "merge") return merge[field];
  if (choice === "both") return [keep[field], merge[field]].filter(Boolean).join("\n\n");
  return keep[field];
}

/**
 * «Fusionar contactos» ([CTO-05]): which contact stays, the value of each field where they differ, what moves to it, and
 * the confirmation. The server works it out again on merging; nothing changes until the person confirms.
 */
export function MergeForm({ previews, defaultKeepId, timezone, bookingsLabel }: MergeFormProps) {
  const router = useRouter();
  const groupId = useId();
  const [keepId, setKeepId] = useState(defaultKeepId);
  const preview = previews.find((item) => item.keep.id === keepId) ?? previews[0];
  const [choicesByKeep, setChoicesByKeep] = useState<Record<string, FieldChoices>>(() => Object.fromEntries(previews.map((item) => [item.keep.id, item.choices])));
  const choices = choicesByKeep[preview.keep.id] ?? preview.choices;
  const { keep, merge, result, joined } = preview;

  function choose(field: MergeField, choice: FieldChoice) {
    setChoicesByKeep((current) => ({ ...current, [keep.id]: { ...choices, [field]: choice } }));
  }

  async function confirmMerge() {
    const outcome = await mergeContactsAction({ keepId: keep.id, mergeId: merge.id, choices });
    if (!outcome.ok || !outcome.data) {
      toast.error(outcome.ok ? "No se ha podido fusionar. Inténtalo de nuevo." : outcome.error);
      return;
    }
    toast.success(outcome.message ?? "Contactos fusionados.");
    router.push(contactPath(outcome.data.keepId));
  }

  const joinedChannels = new Set(joined.map((fold) => fold.channel.id));
  const movedConversations = merge.conversations.filter((conversation) => !joinedChannels.has(conversation.channel.id));

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            <h2 id={`${groupId}-keep`}>Contacto que se queda</h2>
          </CardTitle>
          <CardDescription>El otro contacto desaparece y todo lo suyo pasa a este.</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={keepId} onValueChange={setKeepId} aria-labelledby={`${groupId}-keep`} className="grid gap-3 md:grid-cols-2">
            {previews.map((item) => (
              <Label
                key={item.keep.id}
                htmlFor={`${groupId}-${item.keep.id}`}
                className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal has-data-checked:border-primary has-data-checked:bg-primary-soft"
              >
                <RadioGroupItem id={`${groupId}-${item.keep.id}`} value={item.keep.id} className="mt-0.5" />
                <SideSummary side={item.keep} timezone={timezone} bookingsLabel={bookingsLabel} />
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            <h2>Datos que se quedan</h2>
          </CardTitle>
          <CardDescription>Donde los dos contactos tienen un valor distinto, elige cuál se queda.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {FIELDS.map((field) => {
            const fieldId = `${groupId}-${field}`;
            if (!result.conflicts.includes(field)) {
              const value = valueOf(field, choices[field], keep, merge);
              return (
                <div key={field} className="grid gap-1 text-sm">
                  <span className="text-muted-foreground">{FIELD_LABELS[field]}</span>
                  <span className="break-words whitespace-pre-wrap">{value || "—"}</span>
                </div>
              );
            }
            const options: { value: FieldChoice; text: string }[] = [
              { value: "keep", text: keep[field] ?? "" },
              { value: "merge", text: merge[field] ?? "" },
              ...(field === "notes" ? [{ value: "both" as const, text: "Las dos notas, una detrás de otra" }] : []),
            ];
            return (
              <fieldset key={field} className="grid gap-2 text-sm">
                <legend className="mb-1 text-muted-foreground">{FIELD_LABELS[field]}</legend>
                <RadioGroup value={choices[field]} onValueChange={(value) => choose(field, value as FieldChoice)}>
                  {options.map((option) => (
                    <div key={option.value} className="flex items-start gap-2">
                      <RadioGroupItem id={`${fieldId}-${option.value}`} value={option.value} className="mt-0.5" />
                      <Label htmlFor={`${fieldId}-${option.value}`} className="font-normal break-words whitespace-pre-wrap">
                        {option.text}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            );
          })}
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Etiquetas</span>
            {result.values.labels.length === 0 ? (
              <span>—</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {result.values.labels.map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
              </span>
            )}
          </div>
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Campos personalizados</span>
            {Object.keys(result.values.customFields).length === 0 ? (
              <span>—</span>
            ) : (
              <dl className="grid gap-1">
                {Object.entries(result.values.customFields).map(([name, value]) => (
                  <div key={name} className="flex flex-wrap gap-x-2">
                    <dt className="font-medium">{name}:</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {result.discardedFields.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                No se guardan, porque ya tiene ese campo o no caben:{" "}
                {result.discardedFields.map((item) => `${item.field} = «${item.value}»`).join(", ")}.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            <h2>Qué pasa al fusionar</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid list-disc gap-2 pl-5 text-sm">
            <li>
              {plural(merge.identities.length, "identidad", "identidades")}, {plural(merge.consents, "consentimiento o baja", "consentimientos y bajas")} y{" "}
              {bookingsLabel.toLocaleLowerCase("es-ES")} ({formatNumber(merge.bookings)}) de «{merge.displayName}» pasan a «{keep.displayName}».
            </li>
            {movedConversations.length > 0 ? (
              <li>
                Pasan también {plural(movedConversations.length, "conversación", "conversaciones")}:{" "}
                {movedConversations.map((conversation, index) => (
                  <span key={conversation.id}>
                    {index > 0 ? ", " : null}
                    <ChannelName type={conversation.channel.type} name={conversation.channel.name} />
                  </span>
                ))}
                .
              </li>
            ) : null}
            {joined.map((fold) => (
              <li key={fold.targetId}>
                En <ChannelName type={fold.channel.type} name={fold.channel.name} /> las conversaciones de los dos se unen en una, con todos los mensajes en orden de
                fecha.
              </li>
            ))}
            <li>
              «{merge.displayName}» desaparece. <strong className="font-medium">No se puede deshacer.</strong>
            </li>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link href={CONTACTS_PATH}>Cancelar</Link>
        </Button>
        <ConfirmDialog
          trigger={
            <Button type="button">
              <GitMerge aria-hidden />
              Fusionar contactos
            </Button>
          }
          title={`¿Fusionar «${merge.displayName}» en «${keep.displayName}»?`}
          description={`Todo lo de «${merge.displayName}» pasa a «${keep.displayName}» con los datos que has elegido, y «${merge.displayName}» desaparece. No se puede deshacer.`}
          confirmLabel="Fusionar contactos"
          onConfirm={confirmMerge}
        />
      </div>
    </div>
  );
}
