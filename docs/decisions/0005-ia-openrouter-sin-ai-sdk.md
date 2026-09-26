# 0005 · IA: OpenRouter con un cliente propio, sin AI SDK

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

El encargo (§2 y §7) usa OpenRouter para el chat de los agentes, la transcripción de audios, los embeddings y
el rerank, con la clave puesta en la interfaz (guardada cifrada) o en `OPENROUTER_API_KEY`. La plantilla
recomienda AI SDK para la IA. Había que decidir si se llama a OpenRouter a través de AI SDK o con un cliente
propio, y cómo se comporta la app sin clave.

Datos comprobados el 26-09-2026 (`docs/integracion-openrouter.md`, salvo donde se indica otra fuente):

- La app necesita siete endpoints: `/key`, `/models/user`, `/models`, `/chat/completions`,
  `/audio/transcriptions`, `/embeddings` y `/rerank` (y en el futuro `/audio/speech`).
- Necesita campos propios de OpenRouter: `provider.data_collection: "deny"` y `provider.zdr` (se aceptan en
  chat, embeddings y rerank, pero no en transcripción ni en voz), `session_id` (fija el proveedor durante la
  conversación para aprovechar la caché del prompt; hasta 256 caracteres y 10 minutos sin actividad),
  `models: [principal, respaldo]` y `reasoning.effort`, que cada modelo acepta con valores distintos.
- El coste llega siempre en `usage.cost`, en dólares; no hay que calcularlo con precios guardados.
- Una llamada puede fallar con estado HTTP 200: el cuerpo trae solo `error`, o `finish_reason: "error"`. La
  app necesita su propia tabla de errores con el mensaje en español de cada caso.
- El catálogo filtrado con `supported_parameters=tools` devuelve los precios de la tarifa rebajada `flex`: se
  pide sin filtrar y se filtra en la app.
- El proveedor de OpenRouter para AI SDK (`@openrouter/ai-sdk-provider`, del equipo de OpenRouter) documenta
  chat y embeddings; su README no menciona transcripción, voz, rerank, `/key` ni `/models/user`
  (https://github.com/OpenRouterTeam/ai-sdk-provider, consultado el 26-09-2026).
- Las pruebas nunca llaman a OpenRouter: apuntan a un simulador con `OPENROUTER_BASE_URL` y un `fetch`
  inyectable (`docs/testing.md` y `docs/spec.md`, «Cómo se comprueba que todo funciona»).
- `docs/security.md`: mejor no añadir un paquete para algo que se hace en pocas líneas.

## Opciones consideradas

- **AI SDK con el proveedor de OpenRouter** (la recomendada por la plantilla): cubre el chat y los embeddings,
  pero la transcripción, el rerank, la comprobación de la clave y el catálogo habría que hacerlos aparte igual,
  y los campos propios de OpenRouter pasan por una capa más.
- **Cliente propio con `fetch`.**

## Decisión

Un cliente propio y pequeño en `src/lib/openrouter/`, con `fetch`, la URL base de `OPENROUTER_BASE_URL` (por
defecto la real) y un `fetch` inyectable para las pruebas. Cubre:

- chat sin respuesta por partes, con bucle de herramientas de 6 pasos como máximo, `models: [principal,
  respaldo]`, `provider: { data_collection: "deny" }` y `zdr` si está activado, `session_id` igual a la
  conversación, razonamiento bajo según lo que admita cada modelo, y tokens y coste a `ai_runs`;
- embeddings, transcripción y rerank;
- el catálogo (`/models/user` y, si falla, `/models`) con caché de 12 horas, y «Probar clave» con `/key`.

La clave de Ajustes > IA (cifrada en `integration_settings`) gana a la de `OPENROUTER_API_KEY`. Sin clave, la
IA queda desactivada con el aviso «Añade tu clave de OpenRouter»: los agentes no responden, los audios no se
transcriben y la búsqueda de conocimiento es solo por texto. Los precios nunca van en el código: el coste sale
de `usage.cost` y el catálogo se lee de la API.

## Consecuencias

- Gana: control completo de cada campo que importa (privacidad, caché, respaldo, coste); un solo contrato para
  el cliente y para el simulador de las pruebas; ninguna dependencia más.
- Acepta: el cliente, sus tipos, el bucle de herramientas, los reintentos y la tabla de errores los mantiene
  el proyecto, y hay que seguir los cambios de OpenRouter contrastándolos con
  `docs/integracion-openrouter.md`.
- Acepta: sin respuesta por partes. No hace falta, porque WhatsApp, el correo y el chat web reciben una sola
  respuesta completa.
- Cambiar de proveedor de IA exigiría otro cliente; en el alcance solo está OpenRouter.
- La línea «IA: [AI SDK]» de «Tecnologías» en `AGENTS.md` debe reflejar esta decisión (cambio de `AGENTS.md`
  que se enseña antes a la persona).
