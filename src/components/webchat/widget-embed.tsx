"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /** Set by /widget.js. */
    DominiaChat?: { destroy: (channelId?: string) => void };
  }
}

/**
 * Loads /widget.js for one web chat exactly as a business pastes it on its site ([WEB-01], [WEB-12]), and removes the
 * chat when the page is left, so it never stays on other screens of the app after a client-side navigation.
 */
export function WidgetEmbed({ channelId }: { channelId: string }) {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.async = true;
    script.dataset.channel = channelId;
    document.body.appendChild(script);
    return () => {
      script.remove();
      window.DominiaChat?.destroy(channelId);
    };
  }, [channelId]);
  return null;
}
