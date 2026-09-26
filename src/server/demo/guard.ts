// Where the demo may be loaded: only in local, with DEMO_MODE=true, or by an explicit --force-demo ([ARR-18]).
// The real-data refusal ([ARR-19]) is separate (install-state.ts) and has no override.
import "server-only";

export type DemoEnvironment = { NODE_ENV?: string; DEMO_MODE?: string };

/** Spanish reason why the demo must not be loaded here, or null when it may. */
export function demoRefusal(env: DemoEnvironment, options: { forceDemo?: boolean } = {}): string | null {
  if (options.forceDemo) return null;
  if (env.NODE_ENV === "production") {
    return "La demo no se carga con NODE_ENV=production (es una app publicada). Si de verdad quieres cargarla, añade --force-demo.";
  }
  if (env.DEMO_MODE?.trim() !== "true") {
    return "La demo solo se carga con DEMO_MODE=true en .env.local (lo pone `pnpm run setup` en local). Si de verdad quieres cargarla, añade --force-demo.";
  }
  return null;
}
