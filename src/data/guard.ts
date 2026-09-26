// Permission check of the data layer: every function calls it before reading or writing ([SEG-04], [PER-01]).
import "server-only";
import { can, type Action, type Actor, type PermissionScope } from "@/lib/permissions";
import { AuthError } from "@/server/errors";

/** Throws AuthError("forbidden") unless `actor` may do `action` on `scope`. Nothing is read or changed first. */
export function assertCan(actor: Actor, action: Action, scope?: PermissionScope): void {
  if (!can(actor, action, scope)) throw new AuthError("forbidden");
}
