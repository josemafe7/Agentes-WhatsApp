"use client";

import { PanelRight, PanelRightClose, X } from "lucide-react";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The card is a column next to the conversation only while the conversation keeps its 480 px (DESIGN.md «Bandeja»):
 * 800 px for both, the card's 320 included. Narrower, it is a side panel. The room is measured on the conversation
 * area and not on the window, because the menu takes a different width folded and open. The same width as the
 * `@min-[50rem]` classes below.
 */
const COLUMN_MIN_PX = 800;
const TITLE = "Ficha del contacto";

type PanelState = { columnOpen: boolean; sheetOpen: boolean; toggle: () => void; setSheetOpen: (open: boolean) => void; hasRoom: () => boolean };
const PanelContext = createContext<PanelState | null>(null);

function usePanel(): PanelState {
  const state = useContext(PanelContext);
  if (!state) throw new Error("ContactPanelProvider falta");
  return state;
}

/** The conversation and its contact card, side by side when there is room for both. */
export function ContactPanelProvider({ children }: { children: ReactNode }) {
  const area = useRef<HTMLDivElement>(null);
  const [columnOpen, setColumnOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasRoom = () => (area.current?.clientWidth ?? 0) >= COLUMN_MIN_PX;
  const toggle = () => {
    if (hasRoom()) setColumnOpen((open) => !open);
    else setSheetOpen(true);
  };
  return (
    <PanelContext.Provider value={{ columnOpen, sheetOpen, toggle, setSheetOpen, hasRoom }}>
      <div ref={area} className="@container flex min-h-0 flex-1">
        {children}
      </div>
    </PanelContext.Provider>
  );
}

/** Shows or hides the card (a column when there is room, a side panel when there is not). */
export function ContactPanelToggle() {
  const { columnOpen, toggle, hasRoom } = usePanel();
  // What the button will do, asked when the pointer or the focus reaches it: the tooltip is drawn outside the area.
  const [hides, setHides] = useState(false);
  const refresh = () => setHides(columnOpen && hasRoom());
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" onClick={toggle} onPointerEnter={refresh} onFocus={refresh} aria-label={TITLE}>
          {columnOpen ? <PanelRightClose aria-hidden className="hidden @min-[50rem]:block" /> : null}
          <PanelRight aria-hidden className={columnOpen ? "@min-[50rem]:hidden" : undefined} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hides ? "Ocultar la ficha del contacto" : "Ver la ficha del contacto"}</TooltipContent>
    </Tooltip>
  );
}

export function ContactPanelFrame({ children }: { children: ReactNode }) {
  const { columnOpen, sheetOpen, setSheetOpen } = usePanel();
  return (
    <>
      <aside aria-labelledby="ficha-contacto" className={columnOpen ? "hidden w-80 shrink-0 overflow-y-auto border-l @min-[50rem]:block" : "hidden"}>
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
