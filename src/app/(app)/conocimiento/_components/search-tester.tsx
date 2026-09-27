"use client";

import { Info, LoaderCircle, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionFailure } from "@/lib/action-result";
import { formatNumber } from "@/lib/format";
import { MAX_QUERY_CHARS } from "@/lib/knowledge-limits";
import { testKnowledgeSearchAction } from "../[id]/actions";
import { searchResultScores } from "../_lib/labels";
import { knowledgeDocumentPath } from "../_lib/paths";
import type { KnowledgeSearchResultView, KnowledgeSearchView } from "../_lib/search-view";

type SearchTesterProps = { kbId: string; aiConfigured: boolean };

/** Why this search went only by words ([ARR-14], [CON-12]). */
function textOnlyNote(aiConfigured: boolean): string {
  return aiConfigured
    ? "Esta búsqueda ha ido solo por palabras: los fragmentos aún no tienen embeddings o no se ha podido buscar por significado."
    : "Sin clave de OpenRouter, la búsqueda va solo por palabras. Con la clave, también busca por significado.";
}

function source(result: KnowledgeSearchResultView): string {
  // A FAQ's section is its question, the title too: shown once.
  return [result.title, result.section !== result.title ? result.section : null, result.page !== null ? `pág. ${formatNumber(result.page)}` : null].filter(Boolean).join(" · ");
}

/**
 * «Probar búsqueda» ([CON-16]–[CON-21]): the same search the agents use, over this base and without the chat model,
 * with the fragments numbered as the agent receives them, their scores and their source; «Nada relevante» when
 * nothing reaches the relevance bar ([CON-18]).
 */
export function SearchTester({ kbId, aiConfigured }: SearchTesterProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ query: string; view: KnowledgeSearchView } | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors?.query;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = query;
    startTransition(async () => {
      const result = await testKnowledgeSearchAction(kbId, { query: asked });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      if (result.data) setSearch({ query: asked, view: result.data });
    });
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={submit} noValidate className="grid max-w-2xl gap-3" role="search">
        <Field data-invalid={errors ? true : undefined}>
          <FieldLabel htmlFor="kb-test-query">Pregunta o palabras a buscar</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="kb-test-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="¿Cuánto cuesta un tinte?"
              maxLength={MAX_QUERY_CHARS}
              autoComplete="off"
              aria-invalid={errors ? true : undefined}
              aria-describedby={errors ? "kb-test-query-error" : "kb-test-query-help"}
            />
            <Button type="submit" disabled={pending} className="shrink-0">
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Search aria-hidden />}
              {pending ? "Buscando…" : "Buscar"}
            </Button>
          </div>
          <p id="kb-test-query-help" className="text-sm text-muted-foreground">
            Busca como lo haría el agente, sin gastar el modelo de chat. Escribe lo que preguntaría un cliente.
          </p>
          <FieldError id="kb-test-query-error" errors={errors?.map((message) => ({ message }))} />
        </Field>
        {failure && !errors ? <FormMessage result={failure} /> : null}
      </form>

      {search ? <SearchResults query={search.query} view={search.view} kbId={kbId} aiConfigured={aiConfigured} /> : null}
    </div>
  );
}

function SearchResults({ query, view, kbId, aiConfigured }: { query: string; view: KnowledgeSearchView; kbId: string; aiConfigured: boolean }) {
  return (
    <section aria-labelledby="kb-test-results" aria-live="polite" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="kb-test-results" className="text-lg font-semibold">
          Resultados de «{query}»
        </h2>
        <p className="text-sm text-muted-foreground">
          {view.mode === "hybrid" ? "Por significado y por palabras" : "Solo por palabras"}
          {view.reranked ? ", reordenados" : ""}
          {view.status === "ok" ? ` · ${view.results.length === 1 ? "1 fragmento" : `${view.results.length} fragmentos`}` : ""}
        </p>
      </div>
      {view.mode === "text" ? (
        <p role="note" className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {textOnlyNote(aiConfigured)}
        </p>
      ) : null}
      {view.status === "no_results" || view.results.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={SearchX}
            title="Nada relevante"
            description="El agente contestaría que no lo sabe y ofrecería una persona. Prueba con otras palabras o añade ese dato a la base."
          />
        </div>
      ) : (
        <ol className="grid gap-3">
          {view.results.map((result) => (
            <li key={`${result.rank}-${result.documentId}`} className="grid gap-2 rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-medium">
                  <span className="mr-1 text-muted-foreground tabular-nums">[{result.rank}]</span>
                  <Link href={knowledgeDocumentPath(kbId, result.documentId)} className="underline-offset-4 hover:underline">
                    {source(result)}
                  </Link>
                </p>
                <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {searchResultScores(result, view.reranked).map((score) => (
                    <div key={score.label} className="flex gap-1">
                      <dt className="text-muted-foreground">{score.label}</dt>
                      <dd className="font-mono tabular-nums">{score.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{result.content}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
