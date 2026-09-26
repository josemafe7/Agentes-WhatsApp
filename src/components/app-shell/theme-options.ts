import { Monitor, Moon, Sun } from "lucide-react";

/** Claro / Oscuro / Sistema, remembered per device by next-themes (DESIGN.md «Temas»). */
export const THEME_OPTIONS = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;
