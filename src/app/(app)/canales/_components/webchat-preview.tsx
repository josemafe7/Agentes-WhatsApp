import { ImageIcon, MessageCircle, Mic, SendHorizontal, X } from "lucide-react";
import { primaryCssVars } from "@/lib/color";
import type { WebchatPosition } from "@/lib/webchat-config";
import { cn } from "@/lib/utils";

type WebchatPreviewProps = {
  businessName: string;
  /** The chat's logo, else the business logo; null shows the initials. */
  logoUrl: string | null;
  color: string;
  welcomeMessage: string;
  position: WebchatPosition;
  legalText: string;
  voiceEnabled: boolean;
  imagesEnabled: boolean;
  /** The AI notice the first AI message carries ([CUM-01]). */
  aiNotice: string;
};

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}

/**
 * Live preview of the web chat ([WEB-02]) as DESIGN.md «Chat web (widget)» describes it: always in the light theme,
 * with the chat's colour through the same maths as --primary. It is a picture: nothing in it can be used.
 */
export function WebchatPreview(props: WebchatPreviewProps) {
  const { businessName, logoUrl, color, welcomeMessage, position, legalText, voiceEnabled, imagesEnabled, aiNotice } = props;
  const { light } = primaryCssVars(color);
  const brand = { background: light["--primary"], color: light["--primary-foreground"] };
  const alignment = position === "left" ? "items-start" : "items-end";

  return (
    <figure className="grid gap-2">
      <figcaption className="text-sm font-medium">Vista previa</figcaption>
      <div aria-hidden className={cn("flex min-h-[480px] flex-col justify-end gap-3 rounded-xl border bg-muted p-4", alignment)}>
        <div className="flex w-full max-w-[300px] flex-col overflow-hidden rounded-2xl border border-widget-border bg-widget-surface text-widget-foreground shadow-lg">
          <div className="flex items-center gap-2 p-3" style={brand}>
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-widget-surface/90 text-xs font-semibold text-widget-foreground">
              {logoUrl ? (
                // Served by /api/files; the key changes on every upload.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="size-full object-contain" />
              ) : (
                initials(businessName)
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{businessName || "Tu negocio"}</p>
              <p className="text-xs leading-tight opacity-90">Te responde un asistente con IA · Puedes pedir hablar con una persona</p>
            </div>
            <X className="size-4 shrink-0 opacity-90" />
          </div>
          <div className="grid gap-2 p-3 text-[13px] leading-snug">
            {welcomeMessage.trim() ? <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-widget-muted px-3 py-2 whitespace-pre-line">{welcomeMessage.trim()}</p> : null}
            <p className="max-w-[85%] justify-self-end rounded-2xl rounded-br-sm px-3 py-2" style={brand}>
              Hola, ¿tenéis hueco el sábado por la mañana?
            </p>
            <div className="grid max-w-[85%] gap-1">
              <span className="text-xs text-widget-muted-foreground">Asistente IA</span>
              <p className="rounded-2xl rounded-bl-sm bg-widget-muted px-3 py-2">
                <span className="block text-widget-muted-foreground">{aiNotice}</span>
                <span className="mt-1 block">¡Claro! El sábado tenemos hueco a las 10:00 y a las 11:30. ¿Cuál te viene mejor?</span>
              </p>
            </div>
          </div>
          {legalText.trim() ? <p className="line-clamp-2 border-t border-widget-border px-3 py-2 text-xs text-widget-muted-foreground">{legalText.trim()}</p> : null}
          <div className="flex items-center gap-2 border-t border-widget-border p-2">
            <span className="flex-1 rounded-full border border-widget-border px-3 py-1.5 text-[13px] text-widget-muted-foreground">Escribe tu mensaje…</span>
            {imagesEnabled ? <ImageIcon className="size-4 text-widget-muted-foreground" /> : null}
            {voiceEnabled ? <Mic className="size-4 text-widget-muted-foreground" /> : null}
            <span className="flex size-8 items-center justify-center rounded-full" style={brand}>
              <SendHorizontal className="size-4" />
            </span>
          </div>
        </div>
        <span className="flex size-12 items-center justify-center rounded-full shadow-lg" style={brand}>
          <MessageCircle className="size-6" />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {position === "left" ? "Abajo a la izquierda" : "Abajo a la derecha"} de tu web. Siempre en tema claro; en el móvil ocupa toda la pantalla.
      </p>
    </figure>
  );
}
