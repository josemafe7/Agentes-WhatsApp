"use client";

import { Download, Share, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Chromium's install event (not in the DOM types): prompt() once, then userChoice says what the person chose. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * iPhone and iPad in Safari ([PWA-01], [PWA-03]): push only reaches a web app added to the home screen, with iOS or
 * iPadOS 16.4 or later, so this replaces the button to turn push on.
 */
export function IosInstallSteps() {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">En el iPhone y el iPad, los avisos llegan solo con la app añadida a la pantalla de inicio.</p>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          En Safari, toca Compartir <Share aria-hidden className="inline size-4 align-text-bottom" /> (el cuadrado con una flecha hacia
          arriba).
        </li>
        <li>
          Elige «Añadir a pantalla de inicio» <SquarePlus aria-hidden className="inline size-4 align-text-bottom" />.
        </li>
        <li>Abre la app desde la pantalla de inicio, entra en Mi cuenta y activa aquí los avisos.</li>
      </ol>
      <p className="text-muted-foreground">Necesitas iOS o iPadOS 16.4 o posterior.</p>
    </div>
  );
}

/**
 * Android and computers ([PWA-01]): «Instalar la app» when the browser offers it (beforeinstallprompt, Chromium only),
 * otherwise where to find it in the browser's menu. Nothing once it runs as an installed app.
 */
export function InstallAppHint() {
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onOffer = (event: Event) => {
      // Our own button instead of the browser's banner, on this page only.
      event.preventDefault();
      setOffer(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setOffer(null);
    };
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!offer) return;
    try {
      await offer.prompt();
      const { outcome } = await offer.userChoice;
      if (outcome === "accepted") setInstalled(true);
    } catch {
      toast.error("No se ha podido instalar la app. Prueba desde el menú del navegador.");
    } finally {
      // The browser's offer works once.
      setOffer(null);
    }
  }

  if (installed) {
    return <p className="text-sm text-muted-foreground">App instalada. Ábrela desde la pantalla de inicio o desde tus aplicaciones.</p>;
  }
  if (offer) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={install}>
          <Download aria-hidden />
          Instalar la app
        </Button>
        <p className="text-sm text-muted-foreground">Se abre como una app, con el nombre y el logo del negocio.</p>
      </div>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      También puedes instalarla como una app desde el menú del navegador: «Instalar app» o «Añadir a pantalla de inicio».
    </p>
  );
}
