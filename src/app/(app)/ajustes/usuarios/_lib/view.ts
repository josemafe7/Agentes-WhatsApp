// What /ajustes/usuarios sends to the browser: only the fields the screen shows, dates already formatted in the
// business time zone. Permission checks happen in src/data (owner and admin only).
import "server-only";
import { listInvitations } from "@/data/invitations";
import { getBusinessProfile, getBusinessSettings } from "@/data/settings";
import { listChannelOptions, listUsers, type ChannelOption } from "@/data/users";
import type { InvitableRole, Role } from "@/lib/enums";
import { formatDateTime, formatRelative } from "@/lib/format";
import { can, PERMISSIONS, ROLE_LABELS, type Actor } from "@/lib/permissions";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  isMe: boolean;
  isDemo: boolean;
  disabled: boolean;
  twoFactorEnabled: boolean;
  /** Agent channels; null = every channel (non-agents, or an agent without channels). */
  channelIds: string[];
  channelNames: string[] | null;
  lastSeen: string | null;
  /** Role, channels, deactivate and delete: not on yourself, never an admin on the owner ([PER-05], [PER-06]). */
  canManage: boolean;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: InvitableRole;
  roleLabel: string;
  channelNames: string[] | null;
  expiresAt: string;
  expired: boolean;
  lastSent: string | null;
  invitedByName: string | null;
};

export type UsersView = {
  users: UserRow[];
  invitations: InvitationRow[];
  channels: ChannelOption[];
  requireTwoFactor: boolean;
  canTransferOwnership: boolean;
  /** Whether the person looking has 2FA themselves (turning the requirement on would lock them out until they set it up). */
  meHasTwoFactor: boolean;
};

function namesOf(ids: string[], channels: ChannelOption[]): string[] | null {
  if (ids.length === 0) return null;
  const byId = new Map(channels.map((c) => [c.id, c.name]));
  return ids.map((id) => byId.get(id) ?? "Canal borrado");
}

export async function loadUsersView(actor: Actor): Promise<UsersView> {
  const [users, invitations, channels, settings, profile] = await Promise.all([
    listUsers(actor),
    listInvitations(actor),
    listChannelOptions(actor),
    getBusinessSettings(actor),
    getBusinessProfile(actor),
  ]);
  const now = new Date();
  const timezone = profile.timezone;
  return {
    users: users.map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      roleLabel: ROLE_LABELS[member.role],
      isMe: member.id === actor.userId,
      isDemo: member.isDemo,
      disabled: member.disabledAt !== null,
      twoFactorEnabled: member.twoFactorEnabled,
      channelIds: member.channelIds,
      channelNames: member.role === "agent" ? namesOf(member.channelIds, channels) : null,
      lastSeen: member.lastSeenAt ? formatRelative(member.lastSeenAt, timezone, now) : null,
      canManage:
        member.id !== actor.userId &&
        member.role !== "owner" &&
        can(actor, PERMISSIONS.settings.users, { targetUserId: member.id, targetRole: member.role }),
    })),
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      roleLabel: ROLE_LABELS[invitation.role],
      channelNames: invitation.role === "agent" ? namesOf(invitation.channelIds, channels) : null,
      expiresAt: formatDateTime(invitation.expiresAt, timezone),
      expired: invitation.expired,
      lastSent: invitation.lastSentAt ? formatRelative(invitation.lastSentAt, timezone, now) : null,
      invitedByName: invitation.invitedByName,
    })),
    channels,
    requireTwoFactor: settings.require2faAdmins,
    canTransferOwnership: can(actor, PERMISSIONS.settings.transferOwnership),
    meHasTwoFactor: users.find((member) => member.id === actor.userId)?.twoFactorEnabled ?? false,
  };
}
