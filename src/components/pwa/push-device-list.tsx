"use client";

import { LoaderCircle, Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeviceKind, PushDeviceView } from "./device-label";

const KIND_ICONS: Record<DeviceKind, LucideIcon> = { phone: Smartphone, tablet: Tablet, computer: Monitor };

type PushDeviceListProps = {
  devices: PushDeviceView[];
  /** Fingerprint of this browser's subscription, to mark «Este dispositivo». */
  currentFingerprint: string | null;
  onRemove: (device: PushDeviceView) => Promise<void>;
};

/** «Tus dispositivos con avisos» ([PWA-03]): each one with when it was turned on, its last push and «Quitar». */
export function PushDeviceList({ devices, currentFingerprint, onRemove }: PushDeviceListProps) {
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(device: PushDeviceView) {
    setRemoving(device.id);
    try {
      await onRemove(device);
    } finally {
      setRemoving(null);
    }
  }

  if (devices.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no has activado los avisos push en ningún dispositivo.</p>;
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Tus dispositivos con avisos</h4>
      <ul aria-label="Tus dispositivos con avisos" className="divide-y rounded-xl border">
        {devices.map((device) => {
          const Icon = KIND_ICONS[device.kind];
          const pending = removing === device.id;
          return (
            <li key={device.id} className="flex items-center gap-3 px-4 py-3">
              <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {device.label}
                  {device.fingerprint === currentFingerprint ? <Badge variant="secondary">Este dispositivo</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Activado el {device.activatedOn} · {device.lastPush ? `último aviso ${device.lastPush}` : "todavía sin avisos"}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(device)} disabled={removing !== null} aria-label={`Quitar ${device.label}`}>
                {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                {pending ? "Quitando…" : "Quitar"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
