"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LIVE_REFRESH_MS } from "../_lib/labels";

/**
 * Live status of the documents ([CON-05]): while something is processed or the base is re-indexed, the page asks the
 * server again every few seconds (the server checks the permission on each load). Nothing while the tab is hidden,
 * at once when it is shown again, and it stops by itself when nothing is left in progress.
 */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState !== "hidden") router.refresh();
        schedule();
      }, LIVE_REFRESH_MS);
    }
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      schedule();
    }
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, router]);

  return null;
}
