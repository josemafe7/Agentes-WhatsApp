// Screens without a session (sign-in, two-step code, password reset, invitation): one centred column with the
// business logo, name and colour ([AJU-01]), and the «Modo demo» strip when the demo is on ([ARR-05]).
import { connection } from "next/server";
import type { ReactNode } from "react";
import { businessInitials, DEFAULT_BUSINESS_NAME } from "@/components/app-shell/home-destination";
import { isDemoMode } from "@/components/banners/banner-state";
import { DemoBanner } from "@/components/banners/demo-banner";
import { fileUrl } from "@/data/business";
import { loadBusinessSettings } from "@/data/settings";
import { primaryStyleSheet } from "@/lib/color";

export default async function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The business name and colour come from the database: render per request, never at build time (a page such
  // as /recuperar has no request-time API of its own and would otherwise be prerendered with build-time data).
  await connection();
  const settings = await loadBusinessSettings();
  const businessName = settings.name.trim() || DEFAULT_BUSINESS_NAME;

  return (
    <>
      {/* Business colour: CSS computed from the validated #rrggbb (src/lib/color.ts), never from free text. */}
      <style>{primaryStyleSheet(settings.color)}</style>
      {isDemoMode() ? <DemoBanner /> : null}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            {settings.logoFileKey ? (
              // Served by /api/files (public only for the current logo); next/image would proxy it for nothing.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(settings.logoFileKey)} alt="" className="size-12 rounded-xl object-contain" />
            ) : (
              <div
                aria-hidden
                className="flex size-12 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground"
              >
                {businessInitials(businessName)}
              </div>
            )}
            <p className="text-base font-semibold">{businessName}</p>
          </div>
          {children}
        </div>
      </main>
    </>
  );
}
