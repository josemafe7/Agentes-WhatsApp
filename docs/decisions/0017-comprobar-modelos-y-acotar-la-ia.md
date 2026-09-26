# 0017 · Cómo se comprueban los modelos y qué se acota de la IA

- **Estado:** aceptada (con el permiso general del propietario del 2026-09-26)
- **Fecha:** 2026-09-26

## Contexto y problema

La revisión de la fase 1 encontró cuatro huecos: el paso 4 del asistente guardaba cualquier modelo bien escrito
(gratuito, sin herramientas o inexistente) y el primer agente lo heredaba; sin la lista de modelos guardada, un
agente se guardaba sin comprobar su modelo ([MOD-05]); Ajustes › IA no avisaba de un modelo de transcripción con
proveedores que guardan datos ([AJU-04], [CUM-10]); y una respuesta del modelo podía pedir cientos de herramientas,
todas ejecutadas y anotadas en un registro que no se puede borrar ([AJU-10]).

## Opciones consideradas

- **Comprobar siempre contra la lista, pidiéndola si falta**, o **no guardar un modelo nuevo mientras no se pueda
  comprobar** (sin clave el asistente y los agentes quedarían bloqueados, contra [ARR-14]).
- Para la transcripción: **comparar los proveedores del modelo con la lista pública sin retención** (dos
  peticiones gratuitas), o **dejar solo el texto de ayuda** (no cumple [AJU-04]).
- Para las herramientas: **un máximo de llamadas por respuesta**, o solo el máximo de 6 pasos que ya había.

## Decisión

- Un modelo nuevo (en un agente, en el paso 4 o al crear un agente con los modelos por defecto) se comprueba
  contra la lista guardada o, si todavía no la hay, contra la de OpenRouter, que se pide con la clave (en el paso 4,
  la que se está escribiendo) y se guarda 12 h. Sin clave, o si OpenRouter falla, solo se aplican las reglas que
  no necesitan la lista (forma del nombre y respaldo de otro proveedor). Restaurar una versión pasa las mismas
  comprobaciones. El respaldo por defecto se cambia si queda del mismo proveedor que el modelo del paso 4.
- Si la lista no se puede descargar, no se vuelve a pedir en 5 minutos (salvo «Actualizar lista»). Supervisor y
  Solo lectura solo ven la copia guardada.
- Transcripción: se comparan `/models/{id}/endpoints` y `/endpoints/zdr` por `tag`; el resultado se guarda 12 h
  por modelo y se muestra junto al campo.
- De cada respuesta del modelo se ejecutan como mucho 5 herramientas; las demás reciben un error corto y una sola
  entrada en el registro. Tras un traspaso no se ejecuta nada más de esa respuesta.
- En Vitest, cualquier `fetch` a otra máquina falla (`src/test/setup.ts`).

## Consecuencias

- Gana: ningún camino guarda un modelo que no sirve cuando se puede saber; la transcripción avisa de verdad; un
  modelo manipulado no llena el registro de actividad ni ejecuta acciones después de pasar a una persona.
- Acepta: guardar un agente o el paso 4 puede tardar lo que tarda OpenRouter la primera vez (luego usa la copia);
  sin clave, un modelo inexistente se puede guardar y lo avisa [MOD-06] en cuanto haya lista; Supervisor y Solo
  lectura no ven la lista hasta que alguien que gestiona agentes la cargue.
