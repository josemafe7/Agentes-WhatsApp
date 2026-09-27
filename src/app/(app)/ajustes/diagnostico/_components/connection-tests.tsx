"use client";

import { CircleCheck, CircleX, Info, LoaderCircle, PlugZap, TriangleAlert, type LucideIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectionCheck, ConnectionTestResult } from "@/data/diagnostics-connections";
import { cn } from "@/lib/utils";
import type { ConnectionTestItem } from "../_lib/view";
import { runConnectionTestAction } from "../actions";

// DESIGN.md › Insignias y semáforos: colour always goes with an icon and a word.
const CHECK_STYLES: Record<ConnectionCheck["status"], { icon: LucideIcon; word: string | null; className: string }> = {
  ok: { icon: CircleCheck, word: "Correcto", className: "text-success" },
  warn: { icon: TriangleAlert, word: "Aviso", className: "text-warning" },
  error: { icon: CircleX, word: "Error", className: "text-destructive-text" },
  info: { icon: Info, word: null, className: "text-muted-foreground" },
};

function CheckLine({ check }: { check: ConnectionCheck }) {
  const { icon: Icon, word, className } = CHECK_STYLES[check.status];
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
      <span className="min-w-0">
        {check.text}
        {word ? <span className={cn("ml-2 text-xs", className)}>{word}</span> : null}
      </span>
    </li>
  );
}

function Result({ result }: { result: ConnectionTestResult }) {
  const Icon = result.ok ? CircleCheck : CircleX;
  return (
    <div className="mt-3 grid gap-2 rounded-lg bg-muted/50 p-3">
      <p className="flex items-start gap-2 text-sm font-medium">
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", result.ok ? "text-success" : "text-destructive-text")} />
        <span className="min-w-0">
          <span className="sr-only">{result.ok ? "Correcto: " : "Error: "}</span>
          {result.summary}
        </span>
      </p>
      {result.checks.length > 0 ? (
        <ul className="grid gap-1.5">
          {result.checks.map((check, index) => (
            <CheckLine key={index} check={check} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TestRow({ item }: { item: ConnectionTestItem }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const resultId = useId();

  function run() {
    startTransition(async () => {
      const response = await runConnectionTestAction(item.input);
      // Without permission or after too many tests: said here, like any other result.
      setResult(response.ok ? (response.data ?? null) : { ok: false, summary: response.error, checks: [] });
    });
  }

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {item.title}
            {item.badge ? <Badge variant="outline">{item.badge}</Badge> : null}
          </p>
          <p className="text-sm text-muted-foreground">{item.description}</p>
        </div>
        <Button variant="outline" size="sm" className="self-start" onClick={run} disabled={pending} aria-busy={pending} aria-describedby={resultId}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <PlugZap aria-hidden />}
          {item.action}
        </Button>
      </div>
      {/* Always in the page (never display:none), so screen readers announce each new result. */}
      <div id={resultId} aria-live="polite">
        {pending ? <p className="mt-3 text-sm text-muted-foreground">Probando…</p> : result ? <Result result={result} /> : null}
      </div>
    </li>
  );
}

/** «Pruebas de conexión» ([AJU-11]): each check of the app, run now, with its result in Spanish. */
export function ConnectionTestsSection({ items }: { items: ConnectionTestItem[] }) {
  return (
    <Card id="pruebas-de-conexion" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Pruebas de conexión</CardTitle>
        <CardDescription>
          Comprueba ahora la clave de OpenRouter, el correo del sistema y cada canal conectado, con las mismas pruebas de sus
          pantallas. Los semáforos de los canales quedan al día.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => (
            <TestRow key={item.key} item={item} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
