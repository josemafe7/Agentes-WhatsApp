import { Lock } from "lucide-react";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Stepper } from "@/components/stepper";
import { getSetupStatus } from "@/data/setup";
import { requirePageActor } from "@/server/session";
import { SETUP_STEPS, setupStepInfo } from "./_lib/steps";
import { parseStepParam, resolveSetupView, SETUP_PATH } from "./_lib/view";
import { SETUP_STEP_COMPONENTS } from "./_steps/registry";

type SetupPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STEPPER_STEPS = SETUP_STEPS.map(({ id, label }) => ({ id, label }));

/**
 * First-run wizard ([ASI-01]–[ASI-11]). Without users anyone may create the owner (step 1); after that only the
 * signed-in owner continues, at the first pending step; once finished it redirects to the inbox.
 */
export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { paso } = await searchParams;
  const status = await getSetupStatus();
  const actor = status.hasUsers && !status.completed ? await requirePageActor({ next: SETUP_PATH }) : null;
  const view = resolveSetupView({ status, actorRole: actor?.role ?? null, requestedStep: parseStepParam(paso) });
  if (view.kind === "redirect") redirect(view.to);
  if (view.kind === "owner-only") {
    return (
      <EmptyState
        icon={Lock}
        title="Solo el propietario puede terminar la configuración"
        description="La app estará lista cuando el propietario complete el asistente de arranque. Vuelve a entrar más tarde."
      />
    );
  }

  const info = setupStepInfo(view.step);
  const StepComponent = SETUP_STEP_COMPONENTS[view.step];
  return (
    <div className="space-y-8">
      <Stepper steps={STEPPER_STEPS} current={info.id} />
      <section aria-labelledby="setup-step-title" className="space-y-6">
        <header className="space-y-1">
          <h1 id="setup-step-title" className="text-2xl font-semibold tracking-tight">
            {info.title}
          </h1>
          <p className="text-sm text-muted-foreground">{info.description}</p>
        </header>
        <StepComponent actor={actor} status={status} />
      </section>
    </div>
  );
}
