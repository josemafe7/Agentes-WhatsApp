import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fileUrl, MAX_LOGO_BYTES } from "@/data/business";
import { getBusinessProfile } from "@/data/settings";
import { getAppUrl } from "@/server/app-url";
import { aiDisclosureText } from "@/server/engine/disclosure";
import { removeWebchatLogoAction, uploadWebchatLogoAction } from "../../actions";
import { EmbedCode } from "../../_components/embed-code";
import { WebchatPreview } from "../../_components/webchat-preview";
import { effectiveLookColor, lookValuesFrom } from "../../_lib/look";
import { loadChannelPage } from "../_lib/load";
import { WebchatAppearanceForm } from "./_components/webchat-appearance-form";
import { WebchatLogoForm } from "./_components/webchat-logo-form";

export const metadata: Metadata = { title: "Apariencia y código" };

type PageProps = { params: Promise<{ id: string }> };

/**
 * Apariencia y código (web chats only): the code to paste with «Copiar código» and «Abrir en /widget-demo» ([WEB-01],
 * [WEB-12]), the logo, and the look with its live preview ([WEB-02], [WEB-07], [WEB-10]). Solo lectura sees the code and
 * the preview ([PER-03]).
 */
export default async function WebchatAppearancePage({ params }: PageProps) {
  const page = await loadChannelPage(params, "apariencia");
  if (!page.allowed) return null;
  const { actor, channel, canManage } = page;
  if (!channel.webchat) notFound();
  const [profile, aiNotice] = await Promise.all([getBusinessProfile(actor), aiDisclosureText(channel.disclosureMessage)]);
  const look = lookValuesFrom(channel.webchat, profile.color);
  const businessLogoUrl = profile.logoFileKey ? fileUrl(profile.logoFileKey) : null;
  const chatLogoUrl = channel.webchat.logoFileKey ? fileUrl(channel.webchat.logoFileKey) : null;

  return (
    <div className="grid gap-10">
      <section aria-labelledby="webchat-code" className="grid max-w-2xl gap-3">
        <h2 id="webchat-code" className="text-base font-semibold">
          Código para tu web
        </h2>
        <EmbedCode appUrl={getAppUrl()} channelId={channel.id} />
      </section>

      {canManage ? (
        <>
          <section aria-labelledby="webchat-logo-title" className="grid max-w-2xl gap-3 border-t pt-8">
            <h2 id="webchat-logo-title" className="text-base font-semibold">
              Logo
            </h2>
            <WebchatLogoForm
              logoUrl={chatLogoUrl}
              businessLogoUrl={businessLogoUrl}
              maxBytes={MAX_LOGO_BYTES}
              uploadAction={uploadWebchatLogoAction.bind(null, channel.id)}
              removeAction={removeWebchatLogoAction.bind(null, channel.id)}
            />
          </section>
          <section aria-labelledby="webchat-look" className="grid gap-4 border-t pt-8">
            <h2 id="webchat-look" className="text-base font-semibold">
              Aspecto y opciones
            </h2>
            <WebchatAppearanceForm
              channelId={channel.id}
              initial={look}
              business={{ name: profile.name, color: profile.color }}
              logoUrl={chatLogoUrl ?? businessLogoUrl}
              aiNotice={aiNotice}
            />
          </section>
        </>
      ) : (
        <section aria-labelledby="webchat-look" className="grid max-w-sm gap-4 border-t pt-8">
          <h2 id="webchat-look" className="text-base font-semibold">
            Aspecto
          </h2>
          <WebchatPreview
            businessName={profile.name}
            logoUrl={chatLogoUrl ?? businessLogoUrl}
            color={effectiveLookColor(look, profile.color)}
            welcomeMessage={look.welcomeMessage}
            position={look.position}
            legalText={look.legalText}
            voiceEnabled={look.voiceEnabled}
            imagesEnabled={look.imagesEnabled}
            aiNotice={aiNotice}
          />
        </section>
      )}
    </div>
  );
}
