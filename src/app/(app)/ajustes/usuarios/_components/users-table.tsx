import { ShieldCheck, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChannelOption } from "@/data/users";
import type { UserRow } from "../_lib/view";
import { UserActions } from "./user-actions";

function Badges({ user }: { user: UserRow }) {
  return (
    <>
      {user.isMe ? <Badge variant="outline">Tú</Badge> : null}
      {user.isDemo ? <Badge variant="secondary">Prueba</Badge> : null}
      {user.disabled ? <Badge variant="outline">Desactivado</Badge> : null}
    </>
  );
}

function TwoFactor({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <ShieldCheck aria-hidden className="size-4" />
      Activada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <ShieldOff aria-hidden className="size-4" />
      Sin activar
    </span>
  );
}

function channelsText(user: UserRow): string {
  if (user.role !== "agent") return "—";
  return user.channelNames ? user.channelNames.join(", ") : "Todos";
}

/** Team list: a table from 768 px, cards below (DESIGN.md «Tablas y listas»). */
export function UsersTable({ users, channels }: { users: UserRow[]; channels: ChannelOption[] }) {
  return (
    <>
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Canales</TableHead>
              <TableHead>Dos pasos</TableHead>
              <TableHead>Último acceso</TableHead>
              <TableHead>
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className={user.disabled ? "text-muted-foreground" : undefined}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{user.name}</span>
                    <Badges user={user} />
                  </div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </TableCell>
                <TableCell>{user.roleLabel}</TableCell>
                <TableCell className="max-w-48 truncate" title={channelsText(user)}>
                  {channelsText(user)}
                </TableCell>
                <TableCell>
                  <TwoFactor enabled={user.twoFactorEnabled} />
                </TableCell>
                <TableCell className="tabular-nums">{user.lastSeen ?? "Nunca"}</TableCell>
                <TableCell className="w-12 text-right">{user.canManage ? <UserActions user={user} channels={channels} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-3 md:hidden">
        {users.map((user) => (
          <li key={user.id} className="flex items-start gap-3 rounded-xl border p-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{user.name}</span>
                <Badges user={user} />
              </div>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              <p className="text-sm">
                {user.roleLabel}
                {user.role === "agent" ? ` · Canales: ${channelsText(user)}` : ""}
              </p>
              <div className="flex flex-wrap gap-x-4 text-xs">
                <TwoFactor enabled={user.twoFactorEnabled} />
                <span className="text-muted-foreground">Último acceso: {user.lastSeen ?? "nunca"}</span>
              </div>
            </div>
            {user.canManage ? <UserActions user={user} channels={channels} /> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
