"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * «Salir con cambios pide confirmación» (DESIGN.md «Barra de guardado»): while `dirty`, closing or reloading the tab
 * asks the browser's question, and in-app links (tabs, menu, breadcrumbs) open this dialog before leaving.
 */
export function LeaveGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    // Capture phase: runs before Next.js' <Link> handler, so the navigation can wait for the answer.
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      // Other sites leave through beforeunload; same page (anchors) does not leave.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open) setPendingHref(null);
      }}
      title="¿Salir sin guardar?"
      description="Tienes cambios sin guardar en esta pestaña. Si sales ahora, se perderán."
      confirmLabel="Salir sin guardar"
      destructive
      onConfirm={() => {
        if (pendingHref) router.push(pendingHref);
      }}
    />
  );
}
