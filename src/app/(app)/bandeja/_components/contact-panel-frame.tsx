"use client";

import { PanelRight, PanelRightClose, X } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** From this width the card is a column next to the conversation; below, a side panel (DESIGN.md «Bandeja»). */
const WIDE_QUERY = "(min-width: 1280px)";
const TITLE = "Ficha del contacto";

type PanelState = { columnOpen: boolean; sheetOpen: boolean; toggle: () => void; setSheetOpen: (open: boolean) => void };
const PanelContext = createContext<PanelState | null>(null);

function usePanel(): PanelState {
  const state = useContext(PanelContext);
  if (!state) throw new Error("ContactPanelProvider falta");
  return state;
}

export function ContactPanelProvider({ children }: { children: ReactNode }) {
  const [columnOpen, setColumnOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const toggle = () => {
    if (window.matchMedia(WIDE_QUERY).matches) setColumnOpen((open) => !open);
    else setSheetOpen(true);
  };
  return <PanelContext.Provider value={{ columnOpen, sheetOpen, toggle, setSheetOpen }}>{children}</PanelContext.Provider>;
}

/** Shows or hides the card (a column on wide screens, a side panel on the rest). */
export function ContactPanelToggle() {
  const { columnOpen, toggle } = usePanel();
  const label = columnOpen ? "Ocultar la ficha del contacto" : "Ver la ficha del contacto";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label={TITLE}>
          {columnOpen ? <PanelRightClose aria-hidden className="hidden xl:block" /> : null}
          <PanelRight aria-hidden className={columnOpen ? "xl:hidden" : undefined} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="hidden xl:inline">{label}</span>
        <span className="xl:hidden">Ver la ficha del contacto</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function ContactPanelFrame({ children }: { children: ReactNode }) {
  const { columnOpen, sheetOpen, setSheetOpen } = usePanel();
  return (
    <>
      <aside aria-labelledby="ficha-contacto" className={columnOpen ? "hidden w-80 shrink-0 overflow-y-auto border-l xl:block" : "hidden"}>
        <h2 id="ficha-contacto" className="px-4 pt-4 text-base font-semibold">
          {TITLE}
        </h2>
        {children}
      </aside>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto sm:max-w-sm">
          <SheetHeader className="flex-row items-center justify-between gap-2 border-b">
            <div className="min-w-0">
              <SheetTitle>{TITLE}</SheetTitle>
              <SheetDescription className="sr-only">Datos, identidades por canal y otras conversaciones del contacto.</SheetDescription>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Cerrar">
                <X aria-hidden />
              </Button>
            </SheetClose>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    </>
  );
}
