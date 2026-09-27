import type { Metadata } from "next";
import type { ChannelDetail } from "@/data/channels";
import { listUsers } from "@/data/users";
import { can, PERMISSIONS } from "@/lib/permissions";
import { aiDisclosureText } from "@/server/engine/disclosure";
import { OFF_HOURS_OPTIONS, REPLY_MODE_OPTIONS } from "../../_lib/labels";
import { loadChannelPage } from "../_lib/load";
import { ChannelMembersForm } from "./_components/channel-members-form";
import { ChannelSettingsForm } from "./_components/channel-settings-form";

export const metadata: Metadata = { title: "Configuración del canal" };

type PageProps = { params: Promise<{ id: string }> };

/** What goes in the test list, by type ([CAN-06]): the identities and data the engine compares. */
function allowlistHelp(channel: ChannelDetail): string {
  const common = "Uno por línea (hasta 100).";
  if (channel.type === "whatsapp") return `Números con su prefijo, como +34 600 111 222. ${common}`;
  if (channel.type === "webchat") return `Emails o teléfonos que el visitante haya dado, o su identificador de visitante (en la ficha del contacto). ${common}`;
  if (channel.type === "telegram") return `Identificadores de Telegram de los contactos. ${common}`;
  return `Direcciones de correo, como ana@ejemplo.com. ${common}`;
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[220px_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">{value}</dd>
    </div>
  );
}

/**
 * Configuración (docs/pantallas.md «Panel del canal»): reply mode, AI notice, off-hours behaviour, test mode and the people
 * with the Agent role of this channel. Solo lectura sees the values as a list ([PER-03]).
 */
export default async function ChannelSettingsPage({ params }: PageProps) {
  const page = await loadChannelPage(params, "configuracion");
  if (!page.allowed) return null;
  const { actor, channel, canManage } = page;
  const defaultNotice = await aiDisclosureText(null);

  if (!canManage) {
    return (
      <dl className="grid max-w-2xl gap-4">
        <ReadOnlyRow label="Nombre" value={channel.name} />
        <ReadOnlyRow label="Modo de respuesta" value={REPLY_MODE_OPTIONS.find((option) => option.value === channel.replyMode)?.label ?? channel.replyMode} />
        <ReadOnlyRow label="Aviso de IA del primer mensaje" value={channel.disclosureMessage ?? `Por defecto: ${defaultNotice}`} />
        <ReadOnlyRow
          label="Fuera de horario"
          value={OFF_HOURS_OPTIONS.find((option) => option.value === channel.offHoursBehavior)?.label ?? channel.offHoursBehavior}
        />
        <ReadOnlyRow
          label="Modo pruebas"
          value={channel.testMode ? `Activado: solo ${channel.testAllowlist.length === 1 ? "1 contacto" : `${channel.testAllowlist.length} contactos`}` : "Desactivado"}
        />
      </dl>
    );
  }

  // The people with the Agent role and how many channels each is limited to ([USU-17]). Deactivated ones stay in the
  // list so that saving does not drop their channels behind anyone's back.
  const team = can(actor, PERMISSIONS.settings.users) ? await listUsers(actor) : null;
  const people = (team ?? [])
    .filter((person) => person.role === "agent")
    .map((person) => ({
      id: person.id,
      name: person.disabledAt ? `${person.name} (desactivado)` : person.name,
      email: person.email,
      channelCount: person.channelIds.length,
    }));

  return (
    <div className="grid gap-10">
      <ChannelSettingsForm
        channelId={channel.id}
        initial={{
          name: channel.name,
          replyMode: channel.replyMode,
          disclosureMessage: channel.disclosureMessage ?? "",
          offHoursBehavior: channel.offHoursBehavior,
          testMode: channel.testMode,
          testAllowlist: channel.testAllowlist.join("\n"),
        }}
        defaultNotice={defaultNotice}
        allowlistHelp={allowlistHelp(channel)}
      />
      {team ? (
        <section aria-labelledby="channel-members" className="grid max-w-2xl gap-4 border-t pt-8">
          <div className="grid gap-1">
            <h2 id="channel-members" className="text-base font-semibold">
              Personas con rol Agente
            </h2>
            <p className="text-sm text-muted-foreground">
              Marca quién atiende este canal. Quien no tiene ningún canal marcado ve todos; en cuanto le marcas uno, solo ve los suyos. Los demás
              roles ven todos los canales.
            </p>
          </div>
          <ChannelMembersForm channelId={channel.id} people={people} initial={channel.memberIds.filter((id) => people.some((person) => person.id === id))} />
        </section>
      ) : null}
    </div>
  );
}
