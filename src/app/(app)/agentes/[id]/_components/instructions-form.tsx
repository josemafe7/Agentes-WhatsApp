"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DraftGenerator } from "../../_components/draft-generator";
import { InstructionFields } from "../../_components/instruction-fields";
import { instructionValues, type InstructionValues } from "../../_lib/instructions";
import { EditorForm } from "./editor-form";
import { PromptPreview } from "./prompt-preview";
import { useAgentSection } from "./use-agent-section";

type InstructionsFormProps = { agentId: string; initial: InstructionValues; businessWebsite: string | null; aiConfigured: boolean };

/**
 * Instrucciones ([AGE-04]–[AGE-06]): guided fields, «Generar borrador con IA» (fills the fields, saved only with
 * «Guardar cambios») and «Vista previa del prompt» with what is being typed.
 */
export function InstructionsForm({ agentId, initial, businessWebsite, aiConfigured }: InstructionsFormProps) {
  const section = useAgentSection(agentId, initial, (values) => ({ instructions: values }));
  const [draftOpen, setDraftOpen] = useState(false);

  return (
    <EditorForm section={section}>
      <div className="flex flex-wrap gap-2">
        <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              <Sparkles aria-hidden className="text-ai" />
              Generar borrador con IA
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Generar borrador con IA</DialogTitle>
              <DialogDescription>
                Sustituye lo que hay en los campos por una propuesta. Podrás revisarla y no se guarda hasta que pulses «Guardar cambios».
              </DialogDescription>
            </DialogHeader>
            <DraftGenerator
              agentId={agentId}
              defaultUrl={businessWebsite}
              aiConfigured={aiConfigured}
              idPrefix="editor-draft"
              onDraft={(draft) => {
                section.merge(instructionValues({ ...draft.instructions, freeText: draft.instructions.freeText ?? section.values.freeText }));
                setDraftOpen(false);
                toast.success("Borrador listo. Revísalo y guarda los cambios si te sirve.");
              }}
            />
          </DialogContent>
        </Dialog>
        <PromptPreview agentId={agentId} draft={{ instructions: section.values }} />
      </div>
      <InstructionFields values={section.values} onChange={(key, value) => section.set(key, value)} errorsFor={section.errorsFor} />
    </EditorForm>
  );
}
