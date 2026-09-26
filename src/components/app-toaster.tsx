"use client";

import { Toaster } from "@/components/ui/sonner";
import { useIsMobile } from "@/hooks/use-mobile";

/** Toasts bottom-right on desktop and at the top on mobile, so they never cover the bottom bar or composer. */
export function AppToaster() {
  const isMobile = useIsMobile();
  return <Toaster position={isMobile ? "top-center" : "bottom-right"} closeButton />;
}
