"use client";

import { FileUp, Globe, MessageCircleQuestionMark, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FaqForm } from "./faq-form";
import { FileUploadForm } from "./file-upload-form";
import { UrlForm } from "./url-form";

/**
 * «Añadir contenido» (docs/pantallas.md «Base de conocimiento»): files, a web page (with optional sitemap) or a
 * frequently asked question ([CON-04]). Everything is processed in the background, step by step ([CON-05]).
 */
export function AddContentDialog({ kbId }: { kbId: string }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Fresh forms every time it opens (the previous upload results are gone).
    if (next) setFormKey((key) => key + 1);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          Añadir contenido
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Añadir contenido</DialogTitle>
          <DialogDescription>Se procesa en segundo plano: verás su estado en la lista de documentos.</DialogDescription>
        </DialogHeader>
        <Tabs key={formKey} defaultValue="files" className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="files">
              <FileUp aria-hidden />
              Archivos
            </TabsTrigger>
            <TabsTrigger value="url">
              <Globe aria-hidden />
              Página web
            </TabsTrigger>
            <TabsTrigger value="faq">
              <MessageCircleQuestionMark aria-hidden />
              <span className="sm:hidden">Pregunta</span>
              <span className="hidden sm:inline">Pregunta frecuente</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="files">
            <FileUploadForm kbId={kbId} />
          </TabsContent>
          <TabsContent value="url">
            <UrlForm kbId={kbId} onDone={() => setOpen(false)} />
          </TabsContent>
          <TabsContent value="faq">
            <FaqForm kbId={kbId} idPrefix="add-faq" onDone={() => setOpen(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
