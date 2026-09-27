"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { KbDocumentStatus } from "@/lib/enums";
import { deleteKnowledgeDocumentAction } from "../[id]/actions";
import { documentStatusView } from "../_lib/labels";
import { FaqForm } from "./faq-form";
import { DocumentStatusBadge } from "./status-badge";

export type FaqView = { id: string; question: string; answer: string; status: KbDocumentStatus; error: string | null };

/** The FAQs of a base, each editable in place and deletable ([CON-04], [CON-15]). Viewer only reads them. */
export function FaqList({ kbId, faqs, canManage }: { kbId: string; faqs: FaqView[]; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <ul className="grid gap-3">
      {faqs.map((faq) => (
        <li key={faq.id} className="rounded-xl border p-4">
          {editing === faq.id ? (
            <FaqForm kbId={kbId} faq={faq} idPrefix={`faq-${faq.id}`} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
          ) : (
            <FaqItem faq={faq} canManage={canManage} onEdit={() => setEditing(faq.id)} />
          )}
        </li>
      ))}
    </ul>
  );
}

function FaqItem({ faq, canManage, onEdit }: { faq: FaqView; canManage: boolean; onEdit: () => void }) {
  const status = { status: faq.status, error: faq.error, textOnly: false };
  const { detail } = documentStatusView(status);

  async function remove() {
    const result = await deleteKnowledgeDocumentAction(faq.id);
    if (result.ok) toast.success("Pregunta borrada.");
    else toast.error(result.error);
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 font-medium break-words">{faq.question}</h3>
        {faq.status !== "ready" ? <DocumentStatusBadge doc={status} /> : null}
      </div>
      <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{faq.answer}</p>
      {detail ? <p className="text-xs text-destructive-text">{detail}</p> : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            Editar
          </Button>
          <ConfirmDialog
            trigger={
              <Button type="button" variant="ghost" size="sm">
                <Trash2 aria-hidden />
                Borrar
              </Button>
            }
            title="¿Borrar esta pregunta frecuente?"
            description={`«${faq.question}» dejará de estar en la base y los agentes ya no la encontrarán. No se puede deshacer.`}
            confirmLabel="Borrar pregunta"
            destructive
            onConfirm={remove}
          />
        </div>
      ) : null}
    </div>
  );
}
