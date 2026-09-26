import { redirect } from "next/navigation";
import { connection } from "next/server";
import { homeDestination } from "@/components/app-shell/home-destination";
import { getSetupStatus } from "@/data/setup";
import { getActor } from "@/server/session";

/**
 * «/» only redirects: to the setup wizard while the installation is empty or unfinished ([ASI-01]), to the login
 * page without a session ([USU-02]) and otherwise to the inbox ([USU-01]).
 */
export default async function HomePage() {
  // Reads the database: only at request time, never while prerendering at build time.
  await connection();
  const [setup, actor] = await Promise.all([getSetupStatus(), getActor()]);
  redirect(homeDestination({ setupCompleted: setup.completed, actor }));
}
