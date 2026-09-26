# Revisión

Quién revisa lo construido y cómo. Quien escribe el código no es quien lo revisa: la revisión la hace otro
agente que empieza de cero, sin haber visto la conversación, para que no dé por bueno lo que acaba de hacer.

## Cuándo

Al cerrar cada fase, antes de enseñarme la prueba de que funciona. La revisión completa de antes de
publicar sigue siendo aparte, en una conversación nueva.

## Cómo se lanza

- Si tu herramienta tiene subagentes, lanza uno con el contexto limpio y pásale solo esto: «Revisa la fase
  N siguiendo docs/review.md. No cambies nada.» No le cuentes qué has hecho ni cómo: tiene que verlo por
  su cuenta. En Claude Code ya existe para esto el subagente `revisor`.
- Si no tiene subagentes o no puedes lanzarlo, dímelo y dame esa misma frase para que la pegue yo en una
  conversación nueva.
- Para construir no repartas el trabajo entre subagentes: las fases comparten contexto y se construyen en
  esta conversación. Sí puedes usarlos para buscar y leer.

## Qué hace quien revisa

No cambia nada: lee, ejecuta solo comandos que no modifican nada y devuelve una lista. No se fía de lo que
le cuenten sobre lo que se ha hecho: lo comprueba en la especificación, en el código y en las pruebas.

1. Lee `docs/spec.md` y localiza las reglas de «Qué hace» y los permisos de «Quién puede hacer qué» que
   tocan a la fase.
2. Mira con Git qué ha cambiado en la fase y lo lee: lo que aún no tiene commit o, si la fase ya se
   guardó, su commit.
3. Comprueba, regla por regla, que está construida, que tiene una prueba y que la prueba comprueba lo que
   dice la regla y no lo que hace el código.
4. Comprueba que no se ha construido nada que no esté en la especificación.
5. Repasa de `docs/security.md` solo lo que toca a lo que ha cambiado: claves, permisos comprobados en el
   servidor, validación de lo que entra y datos de otros usuarios.
6. Si existe `DESIGN.md`, comprueba que las pantallas nuevas lo siguen.

## Qué devuelve

Una lista corta, de lo más grave a lo menos. De cada cosa: qué regla o norma no se cumple, dónde está
(archivo y línea) y cómo lo ha comprobado. Solo lo que afecta a lo pedido o a la seguridad: nada de
preferencias de estilo ni de mejoras «por si acaso». Si todo está bien, lo dice en una línea. Si algo no ha
podido comprobarlo, también lo dice.

## Qué se hace con el resultado

Quien construye arregla lo que afecta a la especificación o a la seguridad y vuelve a pasar las pruebas. Lo
demás me lo enseña sin tocarlo. La revisión se hace una vez por fase, salvo que yo pida repetirla.
