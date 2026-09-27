import type { EmailChannelView } from "@/data/email";
import type { EmailChannelCounters } from "@/data/email-panel";
import { formatNumber } from "@/lib/format";
import { filterNote, filterRules, ignoredTotal } from "./_lib/view";

function Counter({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div className="grid gap-1 rounded-lg border p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{formatNumber(value)}</dd>
      <dd className="text-xs text-muted-foreground">{help}</dd>
    </div>
  );
}

/**
 * What the mailbox has done ([COR-14], [COR-16]): emails received and sent, drafts waiting for a person and the ignored
 * ones, then which emails the AI never answers for this provider, with how many of each so far.
 */
export function EmailActivity({ view, counters }: { view: EmailChannelView; counters: EmailChannelCounters }) {
  const ignored = ignoredTotal(view.ignored);
  const note = filterNote(view.type);

  return (
    <>
      <section aria-labelledby="email-activity" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-1">
          <h2 id="email-activity" className="text-base font-semibold">
            Actividad del buzón
          </h2>
          <p className="text-sm text-muted-foreground">Desde que se creó el canal.</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Counter label="Recibidos" value={counters.received} help="Correos de clientes en la bandeja." />
          <Counter label="Enviados" value={counters.sent} help="De la IA y de tu equipo." />
          <Counter label="Borradores por revisar" value={counters.draftsPending} help="Esperan a que alguien los apruebe." />
          <Counter label="Ignorados" value={ignored} help="No crean conversación ni respuesta." />
        </dl>
      </section>

      <section aria-labelledby="email-filters" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-1">
          <h2 id="email-filters" className="text-base font-semibold">
            Correos que la IA no contesta
          </h2>
          <p className="text-sm text-muted-foreground">Se leen pero se ignoran: no crean conversación ni respuesta.</p>
        </div>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          {filterRules(view.type).map((rule) => (
            <li key={rule.key}>{rule.text}</li>
          ))}
        </ul>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        <p className="text-sm text-muted-foreground">
          Además, cuando alguien de tu equipo responde a un hilo desde su propio programa de correo, la IA se pausa en esa conversación durante las horas
          de pausa de Ajustes › Notificaciones.
        </p>
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Ignorados hasta ahora</h3>
          {view.ignored.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha ignorado ningún correo.</p>
          ) : (
            <dl className="grid gap-1 text-sm">
              {view.ignored.map((item) => (
                <div key={item.reason} className="flex items-baseline justify-between gap-4 border-b py-1 last:border-b-0">
                  <dt>{item.label}</dt>
                  <dd className="tabular-nums">{formatNumber(item.count)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>
    </>
  );
}
