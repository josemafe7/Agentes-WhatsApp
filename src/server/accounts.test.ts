// Setup wizard step 1 on an empty installation (this file's database starts without users).
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { user, userRoles } from "@/db/schema";
import { TEST_PASSWORD } from "@/test/factories";
import { createFirstOwner } from "./accounts";
import { ConflictError } from "./errors";

describe("createFirstOwner [ASI-02]", () => {
  it("if two people try at the same time on an empty installation, only one becomes owner", async () => {
    const results = await Promise.allSettled([
      createFirstOwner({ name: "Ana", email: "ana@example.com", password: TEST_PASSWORD }),
      createFirstOwner({ name: "Bea", email: "bea@example.com", password: TEST_PASSWORD }),
      createFirstOwner({ name: "Carla", email: "carla@example.com", password: TEST_PASSWORD }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected.every((r) => r.reason instanceof ConflictError)).toBe(true);
    expect(await db.select().from(user)).toHaveLength(1);
    const roles = await db.select().from(userRoles);
    expect(roles.map((r) => r.role)).toEqual(["owner"]);
  });
});
