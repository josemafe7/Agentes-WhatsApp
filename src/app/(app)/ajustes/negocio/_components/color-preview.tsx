"use client";

import { CircleCheck } from "lucide-react";
import { contrastRatio, deltaEOk, isValidHex, primaryCssVars, type PrimaryThemeVars } from "@/lib/color";
import { formatNumber } from "@/lib/format";

// About one just-noticeable difference (OKLab): smaller corrections are not worth mentioning.
const NOTICEABLE_CHANGE = 0.02;

const SURFACES = {
  light: { label: "Tema claro", background: "#ffffff", foreground: "#09090b", border: "#e4e4e7" },
  dark: { label: "Tema oscuro", background: "#09090b", foreground: "#fafafa", border: "#27272a" },
} as const;

function ThemeSample({ theme, vars }: { theme: keyof typeof SURFACES; vars: PrimaryThemeVars }) {
  const surface = SURFACES[theme];
  return (
    <div
      className="flex flex-1 flex-col gap-3 rounded-xl border p-4"
      style={{ background: surface.background, color: surface.foreground, borderColor: surface.border }}
    >
      <span className="text-xs font-medium opacity-80">{surface.label}</span>
      <span
        className="inline-flex h-9 w-fit items-center rounded-md px-3 text-sm font-medium"
        style={{ background: vars["--primary"], color: vars["--primary-foreground"] }}
      >
        Guardar cambios
      </span>
      <span className="text-sm underline underline-offset-4" style={{ color: vars["--primary-text"] }}>
        Ver la conversación
      </span>
      <span className="rounded-md px-2 py-1.5 text-sm font-medium" style={{ background: vars["--primary-soft"], color: vars["--primary-text"] }}>
        Bandeja
      </span>
    </div>
  );
}

/** Live preview of the business colour (button, link, active menu item) and its contrast in words (DESIGN.md). */
export function ColorPreview({ color }: { color: string }) {
  if (!isValidHex(color)) {
    return <p className="text-sm text-muted-foreground">Escribe un color como #3d6df2 para ver cómo queda.</p>;
  }
  const vars = primaryCssVars(color);
  const foreground = vars.light["--primary-foreground"] === "#ffffff" ? "Texto blanco" : "Texto negro";
  const ratio = contrastRatio(vars.light["--primary"], vars.light["--primary-foreground"]);
  const darkened = deltaEOk(color, vars.light["--primary"]) > NOTICEABLE_CHANGE;
  const lightened = deltaEOk(color, vars.dark["--primary"]) > NOTICEABLE_CHANGE;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <ThemeSample theme="light" vars={vars.light} />
        <ThemeSample theme="dark" vars={vars.dark} />
      </div>
      <p className="flex items-center gap-2 text-sm" aria-live="polite">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
        {foreground} · contraste {formatNumber(ratio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}:1 · cumple
      </p>
      {darkened ? (
        <p className="text-sm text-muted-foreground">Hemos oscurecido un poco tu color en el tema claro para que se lea bien.</p>
      ) : null}
      {lightened ? (
        <p className="text-sm text-muted-foreground">Hemos aclarado un poco tu color en el tema oscuro para que se lea bien.</p>
      ) : null}
    </div>
  );
}
