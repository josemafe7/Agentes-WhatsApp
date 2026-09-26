"use client";
// The picker's list, asked once per kind while the page is open: several pickers of one kind (principal and
// respaldo) share the request, and «Actualizar lista» in one of them reloads them all.
import { useEffect, useState, useSyncExternalStore } from "react";
import { loadModelOptionsAction, refreshModelOptionsAction } from "./actions";
import type { ModelOptionsResult, ModelPickerKind } from "./types";

const LOAD_FAILED: ModelOptionsResult = { status: "error", message: "No se ha podido cargar la lista de modelos. Inténtalo de nuevo." };

const requests = new Map<string, Promise<ModelOptionsResult>>();
const listeners = new Set<() => void>();
let generation = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getGeneration = () => generation;

/** Forgets the lists of this page (after saving or removing the OpenRouter key, or «Actualizar lista»). */
export function resetModelOptions() {
  requests.clear();
  generation += 1;
  for (const listener of listeners) listener();
}

const requestKey = (kind: ModelPickerKind, allowTestOnly: boolean) => `${kind}:${allowTestOnly ? "test" : "live"}`;

function request(kind: ModelPickerKind, allowTestOnly: boolean): Promise<ModelOptionsResult> {
  const key = requestKey(kind, allowTestOnly);
  const cached = requests.get(key);
  if (cached) return cached;
  const pending = loadModelOptionsAction({ kind, allowTestOnly }).catch(() => LOAD_FAILED);
  requests.set(key, pending);
  // Only a loaded list is shared: after a failure or without a key, the next picker asks again.
  void pending.then((result) => {
    if (result.status !== "ready" && requests.get(key) === pending) requests.delete(key);
  });
  return pending;
}

export type UseModelOptions = {
  /** null while loading. */
  result: ModelOptionsResult | null;
  retry: () => void;
  /** «Actualizar lista»; resolves with the error to show, or null. The current list stays if it fails. */
  refresh: () => Promise<string | null>;
  refreshing: boolean;
};

export function useModelOptions(kind: ModelPickerKind, allowTestOnly: boolean): UseModelOptions {
  const currentGeneration = useSyncExternalStore(subscribe, getGeneration, getGeneration);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; result: ModelOptionsResult } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const key = `${requestKey(kind, allowTestOnly)}:${currentGeneration}:${attempt}`;

  useEffect(() => {
    let active = true;
    void request(kind, allowTestOnly).then((result) => {
      if (active) setLoaded({ key, result });
    });
    return () => {
      active = false;
    };
  }, [kind, allowTestOnly, key]);

  async function refresh(): Promise<string | null> {
    setRefreshing(true);
    try {
      const result = await refreshModelOptionsAction({ kind, allowTestOnly }).catch(() => LOAD_FAILED);
      if (result.status === "error") return result.message;
      resetModelOptions();
      if (result.status === "ready") requests.set(requestKey(kind, allowTestOnly), Promise.resolve(result));
      return null;
    } finally {
      setRefreshing(false);
    }
  }

  return {
    result: loaded?.key === key ? loaded.result : null,
    retry: () => setAttempt((value) => value + 1),
    refresh,
    refreshing,
  };
}
