import { Bot } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Configuración inicial",
  robots: { index: false, follow: false },
};

/** Wizard frame (docs/pantallas.md): no sidebar, just the product mark, the theme switch and one column. */
export default function SetupLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot aria-hidden className="size-4" />
          </span>
          DominIA Agentes
        </div>
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6 md:py-10">{children}</main>
    </div>
  );
}
