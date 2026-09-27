"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LeaveGuard } from "@/app/(app)/agentes/[id]/_components/leave-guard";
import { UnsavedChangesBar } from "@/app/(app)/agentes/[id]/_components/editor-form";
import { saveWebchatAppearanceAction } from "../../../actions";
import { WebchatLookFields } from "../../../_components/webchat-look-fields";
import { WebchatPreview } from "../../../_components/webchat-preview";
import { effectiveLookColor, lookToConfig, type WebchatLookValues } from "../../../_lib/look";

type WebchatAppearanceFormProps = {
  channelId: string;
  initial: WebchatLookValues;
  business: { name: string; color: string };
  /** The chat's logo, else the business logo. */
  logoUrl: string | null;
  aiNotice: string;
};

type Failure = { error: string; fieldErrors?: Record<string, string[]> };

/**
 * Apariencia ([WEB-02], [WEB-07], [WEB-10]): the web chat's look and options with the live preview beside, saved with the
 * bar «Cambios sin guardar» (DESIGN.md). The logo has its own form above.
 */
export function WebchatAppearanceForm({ channelId, initial, business, logoUrl, aiNotice }: WebchatAppearanceFormProps) {
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  function save() {
    if (pending || !dirty) return;
    startTransition(async () => {
      const result = await saveWebchatAppearanceAction(channelId, lookToConfig(values));
      if (!result.ok) {
        setFailure({ error: result.error, fieldErrors: result.fieldErrors });
        return;
      }
      setFailure(null);
      setSaved(values);
      toast.success(result.message ?? "Cambios guardados.");
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,640px)_minmax(0,340px)]">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="grid gap-6"
      >
        <WebchatLookFields
          values={values}
          set={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          errorsFor={(field) => failure?.fieldErrors?.[field]}
        />
        <UnsavedChangesBar
          dirty={dirty}
          pending={pending}
          error={failure?.error}
          onDiscard={() => {
            setValues(saved);
            setFailure(null);
          }}
        />
        <LeaveGuard dirty={dirty && !pending} />
      </form>
      <div className="lg:sticky lg:top-20 lg:self-start">
        <WebchatPreview
          businessName={business.name}
          logoUrl={logoUrl}
          color={effectiveLookColor(values, business.color)}
          welcomeMessage={values.welcomeMessage}
          position={values.position}
          legalText={values.legalText}
          voiceEnabled={values.voiceEnabled}
          imagesEnabled={values.imagesEnabled}
          aiNotice={aiNotice}
        />
      </div>
    </div>
  );
}
