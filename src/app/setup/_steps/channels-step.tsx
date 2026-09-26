import { Mail, MessageCircle, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SETUP_STEP } from "@/data/setup";
import { cn } from "@/lib/utils";
import { FinishButton } from "../_components/finish-button";
import { StepFooter } from "../_components/step-footer";
import { INBOX_PATH, setupStepHref } from "../_lib/view";

type ChannelCard = { name: string; description: string; icon: LucideIcon; iconClassName: string };

// The WhatsApp (phase 3) and email (phase 6) wizards and their guides in Ayuda do not exist yet: until then the
// cards only say so, and no button or link leads to a page that is not there. Each phase adds its link here.
const CHANNELS: ChannelCard[] = [
  {
    name: "WhatsApp",
    description: "El número de tu negocio con la API oficial de Meta, con un asistente y una guía paso a paso.",
    icon: MessageCircle,
    iconClassName: "text-channel-whatsapp",
  },
  {
    name: "Correo",
    description: "Gmail, Outlook o cualquier servidor de correo (IMAP y SMTP), con su asistente y su guía.",
    icon: Mail,
    iconClassName: "text-channel-email",
  },
];

/** Step 7 ([ASI-10]): the channels still to connect; finishing saves the date and opens the inbox. */
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
                <Badge variant="secondary" className="ml-auto">
                  Próximamente
                </Badge>
              </div>
              <CardDescription>{channel.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <p className="max-w-[640px] text-sm text-muted-foreground">
        Conectar WhatsApp y el correo llegará en una próxima versión de la app. Cuando esté, lo harás desde Canales. Mientras
        tanto, puedes empezar a trabajar desde la bandeja.
      </p>
      <StepFooter backHref={setupStepHref(SETUP_STEP.webchat)}>
        <FinishButton destination={INBOX_PATH} label="Ir a la bandeja" />
      </StepFooter>
    </div>
  );
}
