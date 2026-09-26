// One demo user per role with the known password ([ARR-09]), marked as demo users ([ARR-20]).
import { hashNewPassword, insertUserWithPassword } from "@/server/accounts";
import { DEMO_PASSWORD, DEMO_USERS } from "../users";
import type { SeedStep } from "../types";

export const usersStep: SeedStep = {
  name: "usuarios",
  prepare: async (ctx) => {
    // Hashing takes CPU time: done before the transaction, one salt per user.
    const hashes = await Promise.all(DEMO_USERS.map(() => hashNewPassword(DEMO_PASSWORD)));
    return async (tx) => {
      for (const [index, demoUser] of DEMO_USERS.entries()) {
        const { userId } = await insertUserWithPassword(tx, { ...demoUser, passwordHash: hashes[index], isDemo: true });
        ctx.refs.userIds.set(demoUser.email, userId);
      }
    };
  },
};
