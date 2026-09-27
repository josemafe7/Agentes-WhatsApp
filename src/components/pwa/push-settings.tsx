"use client";

import { BellOff, BellRing, CircleAlert, CircleCheck, LoaderCircle, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PushDeviceView } from "./device-label";
import { InstallAppHint, IosInstallSteps } from "./install-hint";
import {
  currentSubscription,
  endpointFingerprint,
  fetchPushPublicKey,
  notificationPermission,
  PushRequestError,
  pushSupport,
  readPushEnvironment,
  registerServiceWorker,
  removeDevice,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushPlatform,
  type PushSupport,
} from "./push-client";
import { PushDeviceList } from "./push-device-list";

type Ready = {
  registration: ServiceWorkerRegistration;
  publicKey: string;
  /** This browser's subscription, if any. */
  fingerprint: string | null;
  /** The server has just stored it (the list catches up after the refresh). */
  confirmed: boolean;
  permission: NotificationPermission;
};
type DeviceStatus = Exclude<PushSupport, "supported"> | "checking" | "error" | "denied" | "off" | "on";

const GENERIC_ERROR = "No se ha podido completar. Inténtalo de nuevo.";

// The browser's capabilities do not change while the page is open: read on the client, nothing on the server.
const noChanges = () => () => undefined;
function useBrowserValue<T>(read: () => T): T | null {
  return useSyncExternalStore<T | null>(noChanges, read, () => null);
}

function deviceStatus(support: PushSupport | null, failed: boolean, ready: Ready | null, activeHere: boolean): DeviceStatus {
  if (support === null) return "checking";
  if (support !== "supported") return support;
  if (failed) return "error";
  if (!ready) return "checking";
  if (activeHere) return "on";
  return ready.permission === "denied" ? "denied" : "off";
}

/** The service worker, the installation's public key and this browser's subscription, if any. */
async function prepare(): Promise<Ready> {
  const [registration, publicKey] = await Promise.all([registerServiceWorker(), fetchPushPublicKey()]);
  const subscription = await currentSubscription(registration, publicKey);
  const fingerprint = subscription ? await endpointFingerprint(subscription.endpoint) : null;
  return { registration, publicKey, fingerprint, confirmed: false, permission: await notificationPermission() };
}

function messageOf(error: unknown): string {
  return error instanceof PushRequestError ? error.message : GENERIC_ERROR;
}

/**
 * «Avisos push» in Tus avisos ([PWA-03], [USU-18]): turn push on or off on this device (the permission is only asked
 * from the button, as iPhone requires), how to install the app, and the person's devices with «Quitar».
 */
export function PushSettings({ devices }: { devices: PushDeviceView[] }) {
  const router = useRouter();
  const support = useBrowserValue(() => pushSupport(readPushEnvironment()));
  const platform = useBrowserValue<PushPlatform>(() => readPushEnvironment().platform);
  const standalone = useBrowserValue(() => readPushEnvironment().standalone);
  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (support !== "supported") return;
    let cancelled = false;
    prepare().then(
      (result) => {
        if (cancelled) return;
        setReady(result);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [support, attempt]);

  // On only when the server has this browser: removed from another device, it shows as off here too.
  const activeHere = Boolean(ready?.fingerprint && (ready.confirmed || devices.some((device) => device.fingerprint === ready.fingerprint)));
  const status = deviceStatus(support, failed, ready, activeHere);

  function retry() {
    setFailed(false);
    setAttempt((count) => count + 1);
  }

  async function run(action: (current: Ready) => Promise<Ready | null>, done: string) {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const next = await action(ready);
      if (!next) return;
      setReady(next);
      toast.success(done);
      router.refresh();
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const activate = () =>
    run(async (current) => {
      const fingerprint = await subscribeThisDevice(current.registration, current.publicKey);
      if (fingerprint) return { ...current, fingerprint, confirmed: true, permission: "granted" };
      setReady({ ...current, permission: await notificationPermission() });
      toast.error("Sin tu permiso, el navegador no puede mostrar avisos.");
      return null;
    }, "Avisos activados en este dispositivo.");

  const deactivate = () =>
    run(async (current) => {
      await unsubscribeThisDevice(current.registration);
      return { ...current, fingerprint: null, confirmed: false };
    }, "Avisos desactivados en este dispositivo.");

  async function remove(device: PushDeviceView) {
    try {
      await removeDevice(device.id);
      if (ready && device.fingerprint === ready.fingerprint) {
        // It was this browser: it lets go of the subscription too.
        await (await ready.registration.pushManager.getSubscription())?.unsubscribe();
        setReady({ ...ready, fingerprint: null, confirmed: false });
      }
      toast.success("Dispositivo quitado: ya no recibirá avisos.");
      router.refresh();
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  return (
    <section aria-labelledby="push-settings-heading" className="space-y-4">
      <div className="space-y-1">
        <h3 id="push-settings-heading" className="text-sm font-semibold">
          Avisos push en tus dispositivos
        </h3>
        <p className="text-sm text-muted-foreground">
          Llegan al móvil o al ordenador aunque no tengas la app abierta, sin el texto de los mensajes. Se activan en cada dispositivo.
        </p>
      </div>
      <div className="rounded-xl border p-4">
        <ThisDevice status={status} platform={platform} busy={busy} onActivate={activate} onDeactivate={deactivate} onRetry={retry} />
      </div>
      {standalone === false && platform !== null && platform !== "ios" ? <InstallAppHint /> : null}
      <PushDeviceList devices={devices} currentFingerprint={ready?.fingerprint ?? null} onRemove={remove} />
    </section>
  );
}

type ThisDeviceProps = {
  status: DeviceStatus;
  platform: PushPlatform | null;
  busy: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onRetry: () => void;
};

function Line({ icon, tone, children }: { icon: ReactNode; tone?: string; children: ReactNode }) {
  return (
    <p role="status" className={`flex items-start gap-2 text-sm ${tone ?? ""}`}>
      {icon}
      <span>{children}</span>
    </p>
  );
}

function ThisDevice({ status, platform, busy, onActivate, onDeactivate, onRetry }: ThisDeviceProps) {
  const spinner = <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />;
  const alert = <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />;
  switch (status) {
    case "checking":
      return <Line icon={spinner}>Comprobando este dispositivo…</Line>;
    case "needs-install":
      return <IosInstallSteps />;
    case "insecure":
      return (
        <Line icon={alert} tone="text-muted-foreground">
          Los avisos push necesitan que la app se abra con una dirección segura (https).
        </Line>
      );
    case "unsupported":
      return (
        <Line icon={alert} tone="text-muted-foreground">
          {platform === "ios"
            ? "Actualiza el iPhone o el iPad a iOS 16.4 o posterior para recibir avisos push."
            : "Este navegador no admite avisos push. Prueba con Chrome, Edge, Firefox o Safari actualizados."}
        </Line>
      );
    case "error":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Line icon={alert} tone="text-destructive-text">
            No se han podido comprobar los avisos de este dispositivo.
          </Line>
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            <RotateCw aria-hidden />
            Reintentar
          </Button>
        </div>
      );
    case "denied":
      return (
        <Line icon={alert} tone="text-warning">
          Has bloqueado los avisos de esta app en el navegador. Para activarlos, permítelos en los ajustes del navegador (Notificaciones)
          y vuelve a esta página.
        </Line>
      );
    case "on":
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Line icon={<CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />}>Los avisos están activados en este dispositivo.</Line>
          <Button type="button" variant="outline" onClick={onDeactivate} disabled={busy}>
            {busy ? spinner : <BellOff aria-hidden />}
            {busy ? "Desactivando…" : "Desactivar en este dispositivo"}
          </Button>
        </div>
      );
    case "off":
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Line icon={<BellOff aria-hidden className="mt-0.5 size-4 shrink-0" />} tone="text-muted-foreground">
            Los avisos no están activados en este dispositivo.
          </Line>
          <Button type="button" onClick={onActivate} disabled={busy}>
            {busy ? spinner : <BellRing aria-hidden />}
            {busy ? "Activando…" : "Activar avisos en este dispositivo"}
          </Button>
        </div>
      );
  }
}
