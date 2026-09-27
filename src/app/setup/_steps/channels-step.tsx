import Link from "next/link";
import { BookOpen, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import { EMAIL_GUIDE_PATH } from "@/app/(app)/canales/nuevo/correo/_lib/help";
import { WHATSAPP_GUIDE_PATH } from "@/app/(app)/canales/nuevo/whatsapp/_lib/help";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SETUP_STEP } from "@/data/setup";
import { cn } from "@/lib/utils";
import { FinishButton } from "../_components/finish-button";
import { StepFooter } from "../_components/step-footer";
import { EMAIL_WIZARD_DESTINATION, INBOX_PATH, setupStepHref, WHATSAPP_WIZARD_DESTINATION } from "../_lib/view";

type ChannelCard = {
  name: string;
  description: string;
  icon: LucideIcon;
  iconClassName: string;
  /** Its wizard in Canales: finishing the setup opens it ([ASI-10]). */
  wizard: string;
  connectLabel: string;
  /** Its guide in Ayuda ([AJU-17]). */
  guide: string;
};

const CHANNELS: ChannelCard[] = [
  {
    name: "WhatsApp",
    description: "El número de tu negocio con la API oficial de Meta, con un asistente y una guía paso a paso.",
    icon: MessageCircle,
    iconClassName: "text-channel-whatsapp",
    wizard: WHATSAPP_WIZARD_DESTINATION,
    connectLabel: "Conectar WhatsApp",
    guide: WHATSAPP_GUIDE_PATH,
  },
  {
    name: "Correo",
    description: "Gmail, Outlook o cualquier servidor de correo (IMAP y SMTP), con su asistente y su guía.",
    icon: Mail,
    iconClassName: "text-channel-email",
    wizard: EMAIL_WIZARD_DESTINATION,
    connectLabel: "Conectar el correo",
    guide: EMAIL_GUIDE_PATH,
  },
];

/**
 * Step 7 ([ASI-10]): the links to the WhatsApp and email wizards (and their guides); any of them, or «Ir a la
 * bandeja», saves the finishing date first.
 */
export function ChannelsStep() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {CHANNELS.map((channel) => (
          <Card key={channel.name}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <channel.icon aria-hidden className={cn("size-5", channel.iconClassName)} />
                </span>
                <CardTitle className="text-base">{channel.name}</CardTitle>
              </div>
              <CardDescription>{channel.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-start gap-3">
              <FinishButton destination={channel.wizard} label={channel.connectLabel} variant="outline" />
              <Button asChild variant="ghost">
                <Link href={channel.guide} target="_blank" rel="noopener">
                  <BookOpen aria-hidden />
                  Ver la guía
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="max-w-[640px] text-sm text-muted-foreground">
        Puedes conectarlos ahora o más tarde desde Canales › Añadir canal. Al elegir cualquiera de estas opciones, el
        asistente de arranque queda terminado.
      </p>
      <StepFooter backHref={setupStepHref(SETUP_STEP.webchat)}>
        <FinishButton destination={INBOX_PATH} label="Ir a la bandeja" />
      </StepFooter>
    </div>
  );
}
