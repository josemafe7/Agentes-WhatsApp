"use client";

import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { ToolRow } from "../../_lib/tools";
import { groupTools } from "../herramientas/_lib/tool-groups";
import { EditorForm } from "./editor-form";
import { useAgentSection } from "./use-agent-section";

type ToolsValues = { systemTools: string[] };

/** Herramientas ([AGE-08], [HER-10]): one switch per system tool; the hand-off is always on. */
export function ToolsForm({ agentId, initial, rows }: { agentId: string; initial: ToolsValues; rows: ToolRow[] }) {
  const section = useAgentSection(agentId, initial, (values) => ({ systemTools: values.systemTools }));
  const enabled = new Set(section.values.systemTools);
  const errors = section.errorsFor("systemTools");

  function toggle(name: string, on: boolean) {
    const next = new Set(enabled);
    if (on) next.add(name);
    else next.delete(name);
    // Stable order, so switching on and off again leaves the form unchanged.
    section.set("systemTools", rows.map((row) => row.name).filter((toolName) => next.has(toolName)));
  }

  return (
    <EditorForm section={section}>
      <ToolList rows={rows} enabledNames={section.values.systemTools} onToggle={toggle} />
      {errors ? (
        <p role="alert" className="text-sm text-destructive-text">
          {errors[0]}
        </p>
      ) : null}
    </EditorForm>
  );
}

type ToolListProps = {
  rows: ToolRow[];
  /** Tools switched on in the form; without it, what is saved. */
  enabledNames?: readonly string[];
  onToggle?: (name: string, on: boolean) => void;
};

/** The list, one block per theme; also read-only (without onToggle) for supervisor and viewer. */
export function ToolList({ rows, enabledNames, onToggle }: ToolListProps) {
  const enabledNow = (name: string, saved: boolean) => (enabledNames ? enabledNames.includes(name) : saved);
  const bookingsOn = enabledNow("crear_cita", rows.find((row) => row.name === "crear_cita")?.enabled ?? false);
  const isOn = (row: ToolRow) =>
    row.availability === "always" || (row.availability === "with_bookings" ? bookingsOn : enabledNow(row.name, row.enabled));
  return (
    <div className="grid gap-6">
      {groupTools(rows).map((group) => {
        const headingId = `tool-group-${group.key}`;
        return (
          <div key={group.key} className="grid gap-2">
            <h2 id={headingId} className="text-sm font-semibold">
              {group.title}
            </h2>
            <ul aria-labelledby={headingId} className="grid divide-y rounded-xl border">
              {group.tools.map((row) => {
                const id = `tool-${row.name}`;
                const switchable = onToggle !== undefined && row.availability === "available";
                return (
                  <li key={row.name} className="flex items-start gap-4 p-4">
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={id} className="text-sm font-medium">
                          {row.label}
                        </label>
                        {row.availability === "always" ? (
                          <Badge variant="outline" className="h-[22px] gap-1">
                            <Lock aria-hidden />
                            Siempre activa
                          </Badge>
                        ) : null}
                        {row.availability === "with_bookings" ? (
                          <Badge variant="outline" className="h-[22px] gap-1">
                            <Lock aria-hidden />
                            Va con «Crear citas»
                          </Badge>
                        ) : null}
                        {row.availability === "soon" ? (
                          <Badge variant="secondary" className="h-[22px]">
                            Próximamente
                          </Badge>
                        ) : null}
                      </div>
                      <p id={`${id}-help`} className="text-sm text-muted-foreground">
                        {row.description}
                        {row.name === "transferir_a_humano" ? " Siempre hay una vía a una persona del equipo." : null}
                      </p>
                    </div>
                    <Switch
                      id={id}
                      checked={isOn(row)}
                      disabled={!switchable}
                      onCheckedChange={(checked) => onToggle?.(row.name, checked)}
                      aria-describedby={`${id}-help`}
                      className="mt-0.5"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
