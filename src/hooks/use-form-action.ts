"use client";

import { startTransition, useActionState, type FormEvent } from "react";

/**
 * useActionState for forms that keeps what was typed when the server answers with errors (DESIGN.md: «nunca se
 * borra lo escrito»). React resets uncontrolled fields after an `action` submission, so this submits through
 * onSubmit instead. Returns [state, onSubmit, pending].
 */
export function useFormAction<State>(action: (state: Awaited<State>, formData: FormData) => State | Promise<State>, initialState: Awaited<State>) {
  const [state, dispatch, pending] = useActionState(action, initialState);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    startTransition(() => dispatch(formData));
  }

  return [state, onSubmit, pending] as const;
}
