# 0021 · Relevancia del conocimiento, embeddings pendientes al arrancar y modelos de reordenación

- **Estado:** aceptada (revisiones de especificación, seguridad y aceptación de la fase 4; el propietario puede revisarla)
- **Fecha:** 2026-09-27

## Contexto y problema

Las revisiones de la fase 4 encontraron tres cosas que había que decidir:

1. **Cuándo algo es relevante ([CON-16], [CON-18]).** Con clave, una coincidencia de palabras solo contaba si
   además la similitud por significado llegaba a 0,2. Una pregunta de una o dos palabras frente a un fragmento
   largo se parece poco por significado aunque contenga la palabra: con la demo, «autobus» y «¿Cómo llego en
   autobús?» daban «Nada relevante» y el agente decía «no lo sé», aunque la página 2 del PDF lo explica. La regla
   dice «basta con que aparezca alguna de las palabras». Además, la búsqueda por significado devuelve los 40 más
   cercanos aunque no se parezcan en nada, y rellenaban los 8 resultados de fragmentos sin relación.
2. **Embeddings pendientes con la clave solo en `.env.local` ([CON-12], [ARR-15]).** Solo guardar la clave en
   Ajustes › IA ponía en cola el trabajo de embeddings pendientes; con la clave en `.env.local`, los fragmentos de
   la demo se quedaban sin embeddings para siempre.
3. **Qué modelos de reordenación ofrecer ([AJU-04]).** La lista de modelos de la API no incluye los de
   reordenación, y con ZDR solo uno no guarda datos.

## Opciones consideradas

- Relevancia: (a) cualquier coincidencia de palabras basta, y sin ninguna decide la similitud por significado;
  (b) un mínimo de `bm25` para la coincidencia de palabras; (c) bajar el umbral de similitud con palabras.
- Embeddings pendientes: (a) ponerlos en cola al arrancar el servidor si ya hay clave; (b) que la demo programe
  el trabajo y este mire cada 10 minutos si hay clave; (c) comprobarlo en cada ronda del trabajo en segundo plano.
- Reordenación: (a) una lista comprobada en el código con la de ZDR aparte; (b) preguntar a OpenRouter los
  endpoints de cada modelo, como con la transcripción.

## Decisión

- **Relevancia (a):** basta con una palabra de la pregunta (las palabras vacías nunca se buscan); sin ninguna, la
  similitud del mejor resultado por significado tiene que llegar a 0,3; si se reordenó, decide su puntuación. Los
  resultados por significado por debajo de 0,2 no se mezclan. `bm25` depende del tamaño de cada base y no se
  puede calibrar con un número fijo. Umbrales en `src/server/knowledge/constants.ts`, «no verificados».
- **Embeddings pendientes (a):** `src/instrumentation.ts` llama al arrancar, en segundo plano y nunca durante
  `next build`, a `resumePendingEmbeddings`, que pone en cola el trabajo si hay fragmentos sin embedding y una
  clave. La semilla sigue sin programar trabajos y el trabajo en segundo plano no añade consultas a cada ronda.
- **Reordenación (a):** `src/lib/openrouter/rerank-models.ts` guarda los cinco modelos comprobados el 2026-09-26
  (`docs/integracion-openrouter.md` §7) y los que no guardan datos (hoy `qwen/qwen3-reranker-8b`). El servidor solo
  acepta uno de la lista; con ZDR y otro modelo se guarda, la pantalla avisa y la búsqueda no reordena.

## Consecuencias

- Con una palabra común del negocio en la pregunta («servicio», «precio»), la herramienta devuelve fragmentos
  aunque el dato concreto no esté; el agente, que solo responde con lo que lee, dice entonces que no lo sabe, pero
  esa respuesta cuenta como «no lo sé» solo por su texto, no por `SIN_RESULTADOS`.
- Los umbrales se revisan con conversaciones reales y el modelo de embeddings de verdad, no con el simulado.
- Una clave nueva en `.env.local` cuenta al reiniciar la app; si se carga la demo con la app ya en marcha y la
  clave solo en `.env.local`, los embeddings esperan al siguiente arranque o a guardar la clave en Ajustes › IA.
- La lista de modelos de reordenación hay que revisarla a mano cuando OpenRouter añada o retire alguno.
