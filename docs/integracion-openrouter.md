# Integración con OpenRouter

Referencia técnica de todo lo que la app usa de OpenRouter: comprobar la clave, el catálogo de modelos, el
chat con herramientas, audio, imágenes, PDF, embeddings y rerank. Verificado el **2026-09-26** contra la
documentación oficial (las páginas `.md` de `openrouter.ai/docs` y su OpenAPI) y contra la API pública en
vivo (`/api/v1/models`, `/api/v1/models/{id}/endpoints` y `/api/v1/endpoints/zdr`). Lo que no se ha podido
comprobar va marcado **«no verificado»**. Las fuentes están al final.

Por qué este documento: el cliente de OpenRouter es nuestro (`src/lib/openrouter/`, `fetch` sin SDK) y su
URL base sale de `OPENROUTER_BASE_URL` para que las pruebas apunten al simulador (`e2e/mocks/`). El
simulador y el cliente se construyen con este contrato: lo que no esté aquí no se usa ni se inventa.

## Lo esencial

- Base: `https://openrouter.ai/api/v1`. Todo va en JSON salvo la voz (devuelve bytes de audio).
- Una llamada puede fallar **con estado 200**: se comprueba siempre si el cuerpo trae `error` y si
  `choices[0].finish_reason` es `"error"`.
- El coste llega **siempre** en `usage.cost`, en dólares. No hay que pedirlo (`usage: { include: true }`
  está obsoleto y no hace nada). Nunca se calcula con precios guardados.
- `session_id` existe y hace lo que queremos: fija el proveedor durante la conversación para aprovechar la
  caché del prompt. Le pasamos el id de la conversación.
- `provider.data_collection` y `provider.zdr` se aceptan en chat, embeddings y rerank, **pero no en la
  transcripción ni en la voz**: ahí la privacidad se consigue eligiendo el modelo (ver «Privacidad»).
- Precios del catálogo: texto en dólares por token; ×1e6 da dólares por millón. Dos trampas: pedir el
  catálogo filtrado con `supported_parameters=tools` devuelve precios de la tarifa rebajada `flex`, que no
  se usa por defecto; y en los modelos de transcripción por duración el precio es **por segundo de audio**.
- PDF: se fija siempre el motor. Sin motor, si el modelo no lee PDF por sí mismo, OpenRouter usa
  `mistral-ocr`, que es de pago.
- Voz (futuro): `/audio/speech` solo devuelve `mp3` o `pcm`. Para una nota de voz de WhatsApp hay que
  convertir a OGG/Opus con ffmpeg.

## Conexión y cabeceras

| Cabecera | ¿Obligatoria? | Uso en la app |
|---|---|---|
| `Authorization: Bearer <clave>` | Sí | La clave de Ajustes > IA (cifrada, se descifra solo en el servidor) o `OPENROUTER_API_KEY`. Gana la de la interfaz. |
| `Content-Type: application/json` | Sí en los POST | — |
| `HTTP-Referer` | No | URL de la app. Es lo que crea la ficha de la app en los rankings públicos de OpenRouter. |
| `X-OpenRouter-Title` | No | Nombre de la app. Es el nombre actual; `X-Title` se sigue aceptando por compatibilidad. Sin `HTTP-Referer` no crea ficha; con URL `localhost` hace falta para que cuente. |
| `X-OpenRouter-App-Visibility: hidden` | No | Crea la ficha oculta: no sale en rankings ni en el catálogo público, pero la analítica sigue en la cuenta. Solo actúa la primera vez que se ve esa URL. |
| `X-OpenRouter-Categories` | No | Categorías del catálogo de apps. No la usamos. |
| `x-session-id` | No | Alternativa a `session_id` en el cuerpo (el cuerpo gana). En embeddings, rerank, transcripción y voz solo sirve para agrupar en los registros. |
| `X-OpenRouter-Metadata: enabled` | No | Añade `openrouter_metadata` a la respuesta: qué proveedor se eligió y los intentos. Es la forma documentada de saber el proveedor (ver 3.8). |

**Propuesta** (single-tenant): mandar `HTTP-Referer` con la URL pública de la instalación,
`X-OpenRouter-Title: DominIA Agentes` y `X-OpenRouter-App-Visibility: hidden`. Así cada negocio ve su uso
por app en OpenRouter sin que su dominio aparezca en rankings públicos. Mandar solo el título, sin URL, no
crea ficha.

### Forma de los errores

```json
{ "error": { "code": 402, "message": "Insufficient credits. Add more using https://openrouter.ai/credits", "metadata": { "limit_source": "openrouter_credits" } } }
```

- El estado HTTP coincide con `error.code` cuando la petición falla antes de llegar al modelo (petición mal
  formada, clave, saldo, límites).
- Si el proveedor ya había aceptado la petición, el estado es **200** y llega un cuerpo con solo `error` y
  sin `choices`, o una respuesta con `choices[0].finish_reason: "error"` y `choices[0].error`.
- `error.metadata.error_type` trae un código estable (`context_length_exceeded`, `rate_limit_exceeded`,
  `provider_unavailable`, `content_policy_violation`, `refusal`, `invalid_image`, `timeout`, `server`…).
  Es el campo en el que basarse, no el texto del mensaje.
- `Retry-After` (segundos) puede venir en 429, 503 y en el 402 de «gasto simultáneo». Se respeta antes de
  reintentar.
- En los 500 el mensaje se sustituye por uno genérico. Nunca se muestra al usuario el mensaje en bruto ni
  `metadata.raw`; se guarda en `ai_runs.error` sin datos personales.

### Errores: qué hace la app y qué se muestra

Los estados y sus causas son los documentados; la columna «Qué hace la app» es una **propuesta**. Los
mensajes van al panel (bandeja, «Probar agente», Diagnóstico), nunca al cliente final: si la IA no puede
responder, al cliente no se le escribe nada y la conversación queda para una persona.

| Estado | Cuándo pasa (documentado) | Qué hace la app | Mensaje en español |
|---|---|---|---|
| 400 | Parámetro mal formado; `context_length_exceeded`; imagen o audio no válido | Sin reintento. Si es por longitud, recorta historial una vez y reintenta | «OpenRouter ha rechazado la petición. Revisa el modelo y sus opciones.» / «La conversación es demasiado larga para este modelo.» |
| 401 | Clave ausente, no válida, desactivada o caducada | Sin reintento. Desactiva la IA y muestra el aviso de clave | «La clave de OpenRouter no es válida o ha caducado. Revísala en Ajustes > IA.» |
| 402 `openrouter_credits` | Saldo insuficiente (también con saldo negativo y modelos gratis) | Sin reintento. Aviso a propietario y administradores | «Tu cuenta de OpenRouter no tiene saldo suficiente. Añade créditos en openrouter.ai.» |
| 402 `openrouter_key_limit` | La clave ha llegado a su límite de gasto | Sin reintento. Aviso | «La clave ha llegado a su límite de gasto. Súbelo en OpenRouter o espera a que se reinicie.» |
| 402 `openrouter_in_flight_budget` | Demasiado gasto simultáneo con saldo bajo; es transitorio | Reintento tras `Retry-After` | «OpenRouter está frenando peticiones simultáneas. Se reintentará en unos segundos.» |
| 403 | Moderación del proveedor (`metadata.reasons`, `flagged_input`), guardarraíl de la cuenta, o `refusal` | El respaldo de `models` ya se intenta solo. Si todo falla: sin reintento, traspaso a persona | «El modelo ha rechazado este mensaje por su política de contenido. La conversación pasa a una persona.» |
| 404 | Modelo inexistente, o ningún proveedor cumple las preferencias (p. ej. privacidad) | Sin reintento. Marca el modelo como no disponible | «Este modelo no está disponible con tu configuración de privacidad. Elige otro en el agente.» |
| 408 / 504 / 524 | Tiempo agotado (en OpenRouter, en el proveedor o en el borde de red) | Reintento con espera creciente, máximo 2 | «El modelo ha tardado demasiado en responder. Se reintentará.» |
| 413 | Cuerpo demasiado grande | Sin reintento; reducir o convertir el adjunto | «El archivo es demasiado grande para enviarlo al modelo.» |
| 422 | Petición válida pero no procesable | Sin reintento | «OpenRouter no ha podido procesar la petición.» |
| 429 | Límite de peticiones (plataforma o proveedor) | Reintento tras `Retry-After` o con espera creciente | «Demasiadas peticiones seguidas. Se reintentará en unos segundos.» |
| 500 | Error interno | Reintento, máximo 2 | «Error interno de OpenRouter. Se reintentará.» |
| 502 | El modelo o proveedor está caído o respondió mal | El respaldo se intenta solo; si falla, reintento | «El proveedor del modelo no responde. Se reintentará.» |
| 503 / 529 | Ningún proveedor disponible cumple los requisitos, o proveedor saturado | Reintento tras `Retry-After` | «No hay proveedores disponibles ahora mismo para este modelo. Se reintentará.» |
| 200 con `error` | Fallo del proveedor tras aceptar la petición | Como el `code` que traiga dentro | Según ese código |
| 200 con `finish_reason: "length"` y texto vacío | El razonamiento agotó `max_tokens` | Un reintento con razonamiento más bajo | «El modelo se ha quedado sin espacio para responder. Sube la longitud máxima.» |

## 1. Probar clave: `GET /api/v1/key`

Usado por «Probar clave» (asistente paso 4 y Ajustes > IA). Sin cuerpo; solo `Authorization`.

```json
{ "data": {
  "label": "sk-or-v1-au7...890", "limit": 100, "limit_remaining": 74.5, "limit_reset": "monthly",
  "usage": 25.5, "usage_daily": 25.5, "usage_weekly": 25.5, "usage_monthly": 25.5,
  "byok_usage": 0, "include_byok_in_limit": false,
  "is_free_tier": false, "is_management_key": false, "expires_at": "2027-12-31T23:59:59Z",
  "free_model_daily_requests": { "used": 12, "limit": 50, "remaining": 38 },
  "workspace_id": "0df9e665-…", "organization_id": null, "allowed_data_regions": ["global", "europe", "us"],
  "rate_limit": { "requests": 1000, "interval": "1h", "note": "This field is deprecated and safe to ignore." }
} }
```

- **200**: la clave vale. **401** (`"Missing Authentication header"` u otro texto): no vale. No hay más casos.
- `limit` y `limit_remaining` son el tope de gasto **de la clave**, en dólares; `null` = sin tope.
  `limit_reset`: `daily`, `weekly`, `monthly` o `null`.
- `usage*`: gasto de la clave en dólares (total, día, semana desde el lunes y mes, en UTC).
- `is_free_tier: true` = la cuenta nunca ha comprado créditos: los modelos de pago darán 402. Se avisa.
- `is_management_key: true` = es una clave de gestión, que no puede hacer inferencia. Se rechaza con
  «Esta es una clave de gestión. Crea una clave normal en openrouter.ai/settings/keys.»
- `expires_at`: las claves creadas en el alta caducan a los 180 días. Si faltan menos de 15 días, aviso.
- `rate_limit` está obsoleto: se ignora.
- **Lo que no da**: el saldo de la cuenta. Eso es `GET /api/v1/credits`, que exige una clave de gestión y no
  se usa. «Probar clave» muestra el tope y el gasto de la clave, no el saldo.

Mostrar: «Clave válida · Tope: 74,50 $ de 100 $ (se reinicia cada mes) · Gastado este mes: 25,50 $».

## 2. Catálogo de modelos

### 2.1 `GET /api/v1/models/user` (principal)

Existe. Devuelve los modelos **filtrados por las preferencias de proveedor, la configuración de privacidad y
los guardarraíles de la cuenta** de la clave. Exige `Authorization` (sin clave: 401, comprobado).

- Parámetros: `output_modalities` (por defecto `text`; también `embeddings`, `rerank`, `transcription`,
  `speech`, `image`, `audio`, `video`, `all`, separados por comas), `offset` y `limit` (máx. 1000).
  **No admite** `supported_parameters` ni búsqueda: se filtra en la app.
- Sin `offset` ni `limit` devuelve la lista completa y `links.next` es `null`.
- Refleja la privacidad **de la cuenta**, no la de cada petición: si la cuenta permite proveedores que
  entrenan y nuestra petición manda `data_collection: "deny"`, un modelo de la lista puede fallar con 404.
  Por eso «Validar al guardar» hace una llamada mínima real (ver 2.6) y la guía pide activar también la
  privacidad en la cuenta.

### 2.2 `GET /api/v1/models` (plan B)

Mismo formato, pública (funciona sin clave, comprobado), con caché en el borde. Admite además
`supported_parameters`, `input_modalities`, `sort`, `q`, `context`, `zdr=true`, `region`,
`min_tool_success_rate`, precios mínimos y máximos, etc.

**No usar `supported_parameters=tools` en la consulta.** Comprobado el 2026-09-26: con ese filtro el precio
que devuelve es el de la tarifa `flex` (la mitad), y sin él, el de la tarifa normal. Ejemplo:
`openai/gpt-5.6-luna` sale a 0,10/0,60 $ por millón con el filtro y a 0,20/1,20 $ sin él. Se pide la lista
sin filtros (o `output_modalities=…`) y se filtra `tools` en la app.

Recuento el 2026-09-26: 458 modelos de texto por defecto, 628 con `output_modalities=all`.

### 2.3 Campos de cada modelo

| Campo | Qué es | Uso |
|---|---|---|
| `id` | Lo que se manda en `model` | Se guarda en el agente |
| `canonical_slug` | Identificador permanente (p. ej. `openai/gpt-5.6-luna-20260709`) | Se guarda junto al `id` para reencontrar el modelo si cambia |
| `name`, `description` | Nombre (incluye el proveedor: «OpenAI: GPT-5.6 Luna») y descripción | Selector |
| `created` | Fecha de alta en OpenRouter (epoch en segundos) | Orden «nuevos» |
| `context_length` | Contexto en tokens | Selector y recorte del historial |
| `architecture.input_modalities` | `text`, `image`, `file` (PDF), `audio`, `video` | Iconos de imagen, PDF y audio |
| `architecture.output_modalities` | `text`, `embeddings`, `rerank`, `transcription`, `speech`… | Separar tipos |
| `architecture.tokenizer` | Familia (`GPT`, `Claude`, `Gemini`… y `Router` en los enrutadores) | Detectar enrutadores |
| `pricing` | Precios en texto, dólares por unidad (ver 2.4) | Precio por millón |
| `top_provider` | `context_length`, `max_completion_tokens`, `is_moderated` | Tope de longitud; aviso si hay moderación |
| `per_request_limits` | Topes de tokens por petición o `null` | — |
| `supported_parameters` | `tools`, `tool_choice`, `reasoning`, `temperature`, `max_tokens`, `response_format`… | Filtro `tools`; ocultar temperatura si no está |
| `default_parameters` | Valores por defecto (`temperature`, `top_p`…) o `null` | — |
| `reasoning` | `supported_efforts`, `default_effort`, `default_enabled`, `mandatory`, `supports_max_tokens` | Control de razonamiento (3.6). Falta en modelos sin razonamiento y en enrutadores |
| `expiration_date` | Fecha (AAAA-MM-DD) a partir de la cual puede retirarse, o `null` | Excluir y avisar |
| `knowledge_cutoff` | Fecha de corte de datos o `null` | — |
| `alias_target` | Solo en alias `~…-latest`: `{ slug, name }` del modelo real | Excluir alias |
| `links.details` | Ruta de sus endpoints | Consulta de proveedores |

Muestra real (recortada) del 2026-09-26:

```json
{ "id": "openai/gpt-5.6-luna", "canonical_slug": "openai/gpt-5.6-luna-20260709", "name": "OpenAI: GPT-5.6 Luna",
  "created": 1783590864, "context_length": 1050000,
  "architecture": { "modality": "text+image+file->text", "input_modalities": ["file", "image", "text"], "output_modalities": ["text"], "tokenizer": "GPT", "instruct_type": null },
  "pricing": { "prompt": "0.0000002", "completion": "0.0000012", "input_cache_read": "0.00000002", "input_cache_write": "0.00000025", "web_search": "0.01",
               "overrides": [ { "min_prompt_tokens": 272000, "prompt": "0.0000004", "completion": "0.0000018" } ] },
  "top_provider": { "context_length": 1050000, "max_completion_tokens": 128000, "is_moderated": true },
  "supported_parameters": ["include_reasoning", "max_completion_tokens", "max_tokens", "reasoning", "reasoning_effort", "response_format", "seed", "structured_outputs", "tool_choice", "tools"],
  "reasoning": { "mandatory": false, "default_enabled": true, "default_effort": "medium", "supported_efforts": ["max", "xhigh", "high", "medium", "low", "none"] },
  "expiration_date": null, "knowledge_cutoff": "2026-02-16", "per_request_limits": null }
```

### 2.4 Precios

- Todos los valores son **texto** en dólares por unidad: `prompt` y `completion` por token,
  `input_cache_read`/`input_cache_write` por token de caché, `image` por imagen, `audio` por token de audio,
  `request` por petición, `web_search` por búsqueda. OpenRouter trabaja en dólares (su «crédito» es 1 $).
- Precio por millón = `parseFloat(valor) × 1e6`, en dólares. Se muestra entrada y salida.
- `pricing.overrides` son precios condicionados: por tamaño de prompt (`min_prompt_tokens`) o por franja
  horaria (`utc_start`, `utc_end`, `utc_days`). El precio de arriba es el de condiciones normales. Si una
  entrada trae una condición desconocida, se ignora esa entrada.
- Tarifas `flex` y `priority`: son endpoints aparte y **solo se usan si se piden** (`service_tier`,
  `:floor`, `:nitro`). Nosotros no las pedimos, así que el precio que cuenta es el de la tarifa normal.
- Transcripción: unos modelos cobran **por segundo de audio** (Whisper, Voxtral…: `prompt` es dólares por
  segundo y `completion` es `"0"`) y otros por token (`openai/gpt-4o-mini-transcribe`). La API no tiene un
  campo que diga la unidad: **no verificado** cómo distinguirlos de forma fiable; se muestra el precio con la
  nota «por segundo» solo para los modelos de transcripción con `completion` igual a `"0"`, y el coste real
  sale de `usage.cost`.
- Rerank: el catálogo pone `"0"` en todo; el precio real (por búsqueda o por token) solo aparece en la
  página web del modelo. Ver sección 7.
- El precio mostrado es orientativo. El que vale es `usage.cost` de cada respuesta.

### 2.5 Qué se excluye y cómo se reconoce (datos del 2026-09-26)

| Excluir | Cómo se reconoce | Ejemplos de hoy |
|---|---|---|
| Sin herramientas | `supported_parameters` no incluye `tools` | — |
| Gratis | `id` acaba en `:free` (24 hoy) | `qwen/qwen3.8-27b:free` |
| Otros de precio 0 | `prompt` y `completion` = `"0"` sin `:free`: enrutador gratis y modelos «stealth» | `openrouter/free`, `stealth/space-bunny-alpha` |
| Batch | `id` acaba en `:batch` (76 hoy). Son entradas del catálogo para la Batch API asíncrona, no para el chat | `google/gemini-2.5-flash:batch` |
| Alias | `id` empieza por `~` y trae `alias_target` (19 hoy) | `~anthropic/claude-haiku-latest` → `anthropic/claude-haiku-4.5` |
| Enrutadores | Precio `"-1"` en `prompt` y `completion` (`tokenizer: "Router"`) | `openrouter/auto`, `openrouter/auto-beta`, `openrouter/fusion`, `openrouter/pareto-code`, `openrouter/bodybuilder`, `typesafe/jev-router` |
| Con fecha de retirada | `expiration_date` distinto de `null` (30 hoy) | `google/gemini-2.5-flash` (2026-10-20), `deepseek/deepseek-v3.2` (2026-09-28) |

- Si un modelo **en uso** aparece con `expiration_date`, o deja de aparecer, aviso en el agente y en
  Diagnóstico con la fecha.
- Sufijos de enrutado (`:nitro`, `:floor`, `:exacto`) no aparecen en el catálogo y no los ofrecemos. Un
  sufijo de catálogo inexistente (`:free` en un modelo sin versión gratis) no cae al modelo base: falla.

### 2.6 Consultar un modelo y validarlo

- `GET /api/v1/model/{autor}/{slug}`: un solo modelo, con el mismo objeto en `data`. Resuelve alias. 404 si
  no existe.
- `GET /api/v1/models/{autor}/{slug}/endpoints`: sus proveedores (`provider_name`, `tag`, `pricing` de cada
  endpoint, `supported_parameters`, `status`, `uptime_last_1d`, `supports_implicit_caching`). Los endpoints
  con `tag` acabado en `/flex`, `/priority` o `/fast` son tarifas especiales.
- Validar al guardar: comprobar en la lista cacheada que el principal y el respaldo existen, tienen
  `tools`, no están excluidos y son de **proveedores distintos** (prefijo del `id`: `openai/`, `google/`…).
  Después, una llamada real mínima (`max_tokens: 16`, mismas preferencias de `provider`) a cada uno: un 404
  aquí significa que la privacidad elegida deja el modelo sin proveedores. Coste: fracciones de céntimo.

## 3. Chat: `POST /api/v1/chat/completions`

### 3.1 Cuerpo que enviamos

```json
{
  "models": ["openai/gpt-5.6-luna", "google/gemini-3.1-flash-lite"],
  "messages": [
    { "role": "system", "content": "Reglas… Perfil del negocio… Instrucciones… Archivos de contexto… Datos del momento…" },
    { "role": "user", "content": "Hola, ¿tenéis hueco mañana para un corte?" },
    { "role": "assistant", "content": "¡Hola! Te miro la agenda." },
    { "role": "user", "content": [
      { "type": "text", "text": "Te mando foto del peinado que quiero" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,/9j/4AAQSk…" } }
    ] }
  ],
  "tools": [ { "type": "function", "function": {
    "name": "consultar_disponibilidad", "description": "Huecos libres de un servicio entre dos fechas",
    "parameters": { "type": "object", "properties": { "servicio": { "type": "string" }, "desde": { "type": "string" }, "hasta": { "type": "string" } }, "required": ["servicio", "desde", "hasta"] } } } ],
  "tool_choice": "auto",
  "provider": { "data_collection": "deny", "zdr": true },
  "reasoning": { "effort": "low" },
  "max_tokens": 2000,
  "temperature": 0.4,
  "session_id": "8b1f6c2e-5a0d-4c3b-9e7a-2f4d1c0b9a55",
  "user": "c_2f9a41d0e7",
  "stream": false
}
```

`zdr` solo va si está activado en Ajustes > IA. `temperature` solo si el modelo la admite (3.6).

### 3.2 Mensajes y partes de contenido

- Roles: `system`, `user`, `assistant`, `tool` (y `developer`). `content` es texto o una lista de partes.
- Partes (`type`):
  - `text`: `{ "type": "text", "text": "…" }`.
  - `image_url`: `{ "image_url": { "url": "data:image/jpeg;base64,…" | "https://…", "detail": "auto" } }`.
    Tipos: `image/png`, `image/jpeg`, `image/webp`, `image/gif`. Nuestros archivos son privados: siempre
    como `data:` URL, nunca una URL pública. Se recomienda el texto antes que las imágenes. El máximo de
    imágenes por petición depende del proveedor (**no verificado** un número).
  - `file` (PDF): `{ "file": { "filename": "presupuesto.pdf", "file_data": "data:application/pdf;base64,…" } }`.
    Ver sección 4.
  - `input_audio`: `{ "input_audio": { "data": "<base64 sin prefijo>", "format": "ogg" } }`. Solo base64,
    sin URLs. Ver 5.2.
- Solo se mandan partes que el modelo admite según `architecture.input_modalities`; si no, la imagen se
  describe antes con el modelo de visión y el audio va transcrito (motor, paso 4).

### 3.3 Herramientas y bucle (máximo 6 pasos)

- `tools`: lista de `{ "type": "function", "function": { name, description, parameters (JSON Schema), strict? } }`.
  `name`: letras, números, `_` y `-`, máximo 64 caracteres.
- `tool_choice`: `"auto"` (por defecto), `"none"`, `"required"` o `{ "type": "function", "function": { "name": "…" } }`.
- `parallel_tool_calls`: por defecto `true`. El bucle debe aceptar varias llamadas en una misma respuesta.
- La respuesta pide herramientas con `finish_reason: "tool_calls"` y:

```json
{ "role": "assistant", "content": null, "tool_calls": [ { "id": "call_abc123", "type": "function",
  "function": { "name": "consultar_disponibilidad", "arguments": "{\"servicio\":\"corte\",\"desde\":\"2026-09-27\",\"hasta\":\"2026-09-27\"}" } } ] }
```

- Siguiente petición: los mismos mensajes + ese mensaje del asistente tal cual + un mensaje por llamada:
  `{ "role": "tool", "tool_call_id": "call_abc123", "content": "{\"huecos\":[\"10:00\",\"12:30\"]}" }`.
- **`tools` va en todas las peticiones del bucle**, no solo en la primera (lo exige OpenRouter para validar).
- `arguments` es un texto JSON: se parsea y se valida con zod; si no vale, se devuelve un error compacto
  como resultado de la herramienta en vez de ejecutarla.
- Si el mensaje del asistente trae `reasoning_details` (o `reasoning`), se devuelve igual en las peticiones
  siguientes del mismo turno: los modelos de razonamiento lo necesitan para seguir tras la herramienta, y
  los bloques no se pueden reordenar ni editar. No se guarda en la base de datos ni se muestra.
- Propuesta: al sexto paso sin respuesta final se corta, se registra y la conversación pasa a una persona.

### 3.4 Respaldo de modelo (`models`)

- `models: [principal, respaldo]`: si el primero devuelve error, OpenRouter prueba el siguiente. Cualquier
  error puede provocarlo: contexto demasiado largo, moderación, límites o caída.
- Se cobra el modelo que respondió, y ese es el que viene en `model` de la respuesta.
- No hay un máximo documentado de modelos en la lista (**no verificado**); usamos dos.

### 3.5 Preferencias de proveedor (`provider`)

| Campo | Por defecto | Qué hace | Nuestro valor |
|---|---|---|---|
| `data_collection` | `allow` | `deny`: solo proveedores que no guardan datos de forma no transitoria ni entrenan con ellos. Si ninguno cumple, error | `deny` siempre |
| `zdr` | — | `true`: solo endpoints sin retención de datos. Suma («o») con el ajuste de la cuenta; no puede desactivarlo | Según Ajustes > IA |
| `allow_fallbacks` | `true` | Probar otros proveedores del mismo modelo si falla el primero | No se manda (`true`) |
| `require_parameters` | `false` | Solo proveedores que admitan **todos** los parámetros enviados | No se manda: con `temperature` dejaría sin proveedores a modelos que no la admiten (404) |
| `order`, `only`, `ignore` | — | Lista de proveedores a probar, permitir o saltar | No se manda: `order` desactiva el enrutado pegajoso de la caché |
| `sort` | — | Ordenar por `price`, `throughput` o `latency` en vez de repartir | No se manda |
| `max_price`, `quantizations`, `preferred_max_latency`… | — | Filtros finos | No se usan |

Aunque `require_parameters` sea `false`, OpenRouter ya prefiere los proveedores que soportan `tools`
cuando la petición las lleva.

### 3.6 Razonamiento, longitud y temperatura

- `reasoning`: `{ "effort": "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none" }`, o
  `{ "max_tokens": N }` (estilo Anthropic), más `exclude` (por defecto `false`) y `enabled`. `reasoning_effort`
  es un atajo equivalente; `include_reasoning` está obsoleto.
- «Razonamiento bajo por defecto»: se manda `effort: "low"` **solo si** está en
  `reasoning.supported_efforts` del modelo. Si no está, el valor más bajo de la lista que no sea `"none"`.
  Si el modelo no tiene objeto `reasoning`, no se manda nada. Nunca `"none"` si `mandatory` es `true`.
  Qué pasa si se manda un valor que el modelo no lista: **no verificado**. Hay modelos que solo aceptan
  `high` y `xhigh`, o que tienen razonamiento obligatorio.
- `max_tokens` (entero ≥ 1): el razonamiento cuenta dentro de este tope. Si se lo come entero, la respuesta
  llega con `finish_reason: "length"`, texto vacío y los tokens cobrados. Se detecta con
  `usage.completion_tokens − usage.completion_tokens_details.reasoning_tokens ≈ 0`. Tope por defecto
  generoso (p. ej. 2000); nunca por encima de `top_provider.max_completion_tokens`.
- `max_completion_tokens`: el esquema de OpenRouter marca `max_tokens` como obsoleto a favor de este, pero
  hoy 480 modelos listan `max_tokens` y solo 72 `max_completion_tokens`. Se usa `max_tokens`. Algunos
  proveedores exigen un mínimo de 16.
- `temperature`: de 0 a 2, por defecto 1. Si el modelo no la lista en `supported_parameters` (p. ej.
  `openai/gpt-5.6-luna`), se ignora; el editor la desactiva con la nota «Este modelo no la usa».

### 3.7 `session_id` y `user`

- `session_id` (cuerpo, o cabecera `x-session-id`; máximo 256 caracteres): **clave del enrutado pegajoso**.
  Todas las peticiones de la sesión van al mismo proveedor para aprovechar su caché, desde la primera
  respuesta correcta. También agrupa las peticiones en los registros. La sesión caduca tras 10 minutos sin
  peticiones. Valor: el id de la conversación. Confirmado: no es lo mismo que `user`.
- `user`: identificador estable del cliente final para aislar abusos. OpenRouter lo convierte en un hash
  antes de mandarlo al proveedor. Sin él, un bloqueo del proveedor por un mensaje abusivo puede afectar a
  **toda la cuenta del negocio**. Propuesta: un seudónimo (HMAC del `contact_id` con una clave del servidor),
  nunca el teléfono ni el email.

### 3.8 Respuesta y qué se guarda en `ai_runs`

```json
{ "id": "gen-1790380800-AbCdEf123", "object": "chat.completion", "created": 1790380800,
  "model": "openai/gpt-5.6-luna", "service_tier": "default", "system_fingerprint": null,
  "choices": [ { "index": 0, "finish_reason": "stop", "native_finish_reason": "completed",
    "message": { "role": "assistant", "content": "¡Claro! Mañana tengo libre a las 10:00 o a las 12:30. ¿Cuál te viene mejor?" } } ],
  "usage": { "prompt_tokens": 5234, "completion_tokens": 58, "total_tokens": 5292,
    "prompt_tokens_details": { "cached_tokens": 4864, "cache_write_tokens": 0 },
    "completion_tokens_details": { "reasoning_tokens": 12 },
    "cost": 0.00024088, "is_byok": false,
    "cost_details": { "upstream_inference_prompt_cost": 0.00017128, "upstream_inference_completions_cost": 0.0000696 } } }
```

(Ejemplo con la forma documentada; los números están calculados con los precios del 2026-09-26.)

| `ai_runs` | De dónde sale |
|---|---|
| Modelo pedido | `models[0]` de nuestra petición |
| Modelo usado | `model` de la respuesta (el que respondió y se cobró) |
| Proveedor | **No está en el esquema documentado de la respuesta.** Con `X-OpenRouter-Metadata: enabled`: el `provider` de `openrouter_metadata.endpoints.available[]` con `selected: true`. Alternativa: `GET /api/v1/generation?id=<id>` devuelve `provider_name`, `total_cost`, `latency`… |
| Tokens | `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens`, `cache_write_tokens`, `completion_tokens_details.reasoning_tokens` |
| Coste | `usage.cost`, en dólares (incluye la caché y los descuentos) |
| Latencia | Medida por nosotros (y `openrouter_metadata.generation_time` si se pidió) |
| Fin | `choices[0].finish_reason`: `stop`, `tool_calls`, `length`, `content_filter` o `error` |
| Id | `id` (`gen-…`), para soporte y para `/generation` |

- `finish_reason: "content_filter"` con `message.refusal`: el modelo se ha negado dentro de una respuesta
  correcta. No es un error: se trata como «no sabe» y se ofrece una persona.
- Sin streaming: `usage` llega siempre en la respuesta completa.

### 3.9 Caché del prompt: por qué el prompt va de lo estable a lo variable

- OpenAI, DeepSeek, Grok, Moonshot, Z.AI y Gemini (2.5 y posteriores) cachean **solos** el principio
  repetido del prompt. OpenAI necesita al menos 1024 tokens.
- Anthropic y Alibaba necesitan marcas `cache_control: { "type": "ephemeral" }` (5 minutos; `"ttl": "1h"`
  cuesta más al escribir). Anthropic admite además `cache_control` en la raíz de la petición (caché
  automática). Mínimo 1024–4096 tokens según el modelo. Se mandan solo con modelos `anthropic/…` y con los
  de Alibaba que lista la guía de caché; con el resto el efecto está **no verificado**.
- Solo se reaprovecha el **prefijo idéntico**. Por eso el orden del motor (reglas → perfil → instrucciones →
  archivos de contexto → datos del momento → historial) es el correcto. Nota: si «fecha y hora» cambia en
  cada turno, lo que va detrás no se reaprovecha; redondearla (p. ej. al cuarto de hora) alarga el prefijo.
- `session_id` mantiene el proveedor, sin lo cual la caché de otro proveedor no sirve.
- Coste: la lectura de caché es mucho más barata (en `gpt-5.6-luna`, 0,02 $/M frente a 0,20 $/M). Desde la
  familia GPT-5.6, OpenAI **cobra también la escritura** a 1,25× el precio de entrada. Se ve en
  `cached_tokens` y `cache_write_tokens`.
- La caché en memoria del proveedor no cuenta como retención: se permite con ZDR.

## 4. Imágenes y PDF

**Imágenes**: parte `image_url` con `data:` URL (sección 3.2). Si el modelo del agente no tiene `image` en
`input_modalities`, el motor pide antes al modelo de visión (Ajustes > IA) una descripción breve en español
y la pasa como texto. Errores propios: `invalid_image`, `image_too_large`, `image_too_small`,
`unsupported_image_format` (400).

**PDF**: parte `file` con `file_data` en `data:application/pdf;base64,…` (también acepta URL o `file_id` de la
Files API; no los usamos). Motores del plugin `file-parser`:

| Motor | Precio | Cuándo |
|---|---|---|
| `native` | Tokens de entrada del modelo | Solo si el modelo tiene `file` en `input_modalities` |
| `cloudflare-ai` | Gratis | PDF con texto, modelo sin lectura nativa |
| `mistral-ocr` | 2 $ por 1.000 páginas (2,2 $ en región EE. UU.), cobrado por OpenRouter aunque haya clave propia | PDF escaneado |

- **Sin motor**, OpenRouter usa el nativo si existe y, si no, **`mistral-ocr` (de pago)**. Por eso se manda
  siempre: `"plugins": [{ "id": "file-parser", "pdf": { "engine": "native" | "cloudflare-ai" } }]`.
- `pdf-text` está obsoleto (redirige a `cloudflare-ai`).
- `mistral-ocr` envía como mucho 8 imágenes por PDF al modelo.
- La respuesta puede traer `message.annotations` con el PDF ya procesado; reenviarlas evita pagar el
  procesado otra vez. Opcional.
- Para la base de conocimiento el texto se extrae en local (§8 de la especificación); el OCR con clave
  propia de Mistral es otra integración, aparte de este motor.

## 5. Audio

### 5.1 Transcripción: `POST /api/v1/audio/transcriptions`

Existe. JSON con el audio en base64:

```json
{ "model": "openai/whisper-large-v3-turbo",
  "input_audio": { "data": "T2dnUwACAAAAAAAAAAB…", "format": "ogg" },
  "language": "es", "temperature": 0 }
```

- `input_audio.data`: base64 **sin** prefijo `data:`. `format`: `wav`, `mp3`, `flac`, `m4a`, `ogg`, `webm`,
  `aac`… (según proveedor). Obligatorios: `model` e `input_audio`.
- `language`: código ISO-639-1 (`"es"`); si falta, se detecta solo.
- `response_format`: `json` (por defecto) o `verbose_json` (idioma, duración, segmentos y, con
  `timestamp_granularities: ["word"]`, palabras). Algunos modelos rechazan `verbose_json` con 400.
- `provider`: **solo** `provider.options` (opciones propias de cada proveedor). Las preferencias de
  enrutado (`order`, `only`, `ignore`) no se aplican a la transcripción, y `data_collection`/`zdr` no
  existen en esta petición.
- `session_id`: la referencia de la API lo admite en el cuerpo, pero la guía de caché dice que en
  transcripción solo vale la cabecera `x-session-id`. Se usa la cabecera. Solo agrupa en los registros.
- También admite `multipart/form-data` al estilo OpenAI (`file`, `model`, `language`…), con **25 MB**
  como máximo. Lo de más tamaño va en JSON. No lo usamos.
- Tiempo: los proveedores cortan a los **60 s por petición**. No es un parámetro: nuestro cliente pone su
  propio límite de 60 s y los audios largos se trocean. Las notas de voz de WhatsApp suelen ser cortas.

Respuesta:

```json
{ "text": "Hola, quería saber si mañana tenéis hueco para un corte.",
  "usage": { "seconds": 4.1, "cost": 0.0000137 } }
```

`usage` puede traer además `input_tokens`, `output_tokens` y `total_tokens` (modelos por tokens). Cabecera
`X-Generation-Id`. Errores: 400, 401, 402, 403, 404, 413, 429, 500, 502, 503, 504, 524 y 529.

**Notas de voz de WhatsApp (OGG/Opus)**: `ogg` está en la lista de formatos y la guía pone como ejemplo
«notas de voz Opus», pero que cada proveedor acepte Opus dentro de OGG está **no verificado**. Se mantiene
la estrategia de la especificación: probar tal cual con `format: "ogg"`; si da 400, convertir a MP3 con
ffmpeg y reintentar; si falla, modelo de respaldo, pero solo si todos sus proveedores están en la lista ZDR
(como la transcripción no admite `zdr` por petición, un respaldo con proveedores que guardan datos se saltaría el
aviso de Ajustes; decisión 0018); y como último recurso, 5.2.

Modelos: `GET /api/v1/models?output_modalities=transcription` (24 el 2026-09-26) o `/models/user` con el
mismo parámetro. Recomendados en la sección 10.

### 5.2 Plan B: audio dentro del chat

Parte `input_audio` en `/chat/completions` hacia un modelo con `audio` en `input_modalities` (82 hoy, entre
ellos `google/gemini-3.1-flash-lite`), pidiendo «Transcribe literalmente este audio en español». Solo
base64. Formatos: `wav`, `mp3`, `aiff`, `aac`, `ogg`, `flac`, `m4a`, `pcm16`, `pcm24` (según proveedor). Aquí
sí se aplican `provider.data_collection` y `zdr`, y el coste llega en `usage.cost` como cualquier chat.

## 6. Embeddings: `POST /api/v1/embeddings`

```json
{ "model": "openai/text-embedding-3-small",
  "input": ["Documento: Tarifas > Cortes\nCorte de señora: 25 €…", "Documento: Horario > Festivos\n…"],
  "dimensions": 1536, "encoding_format": "float",
  "provider": { "data_collection": "deny" } }
```

- `input`: texto o lista de textos (también tokens o partes multimodales, que no usamos). Sin textos vacíos.
- `dimensions`: aceptado por el esquema de OpenRouter. Que se reenvíe a todos los proveedores está **no
  verificado**; con `text-embedding-3-small` da igual, porque su tamaño nativo es 1536 (OpenAI). Se valida
  siempre `embedding.length === 1536` y, si no, error claro.
- `encoding_format`: `float` o `base64`. `input_type` (p. ej. `search_query`) existe para modelos que lo
  usan; OpenAI no.
- `provider`: admite las mismas preferencias que el chat, incluidos `data_collection` y `zdr`.
- Sin streaming. `x-session-id` para agrupar.

```json
{ "id": "embd-…", "object": "list", "model": "openai/text-embedding-3-small",
  "data": [ { "object": "embedding", "index": 0, "embedding": [0.0123, -0.0456, "…1536 valores"] } ],
  "usage": { "prompt_tokens": 812, "total_tokens": 812, "cost": 0.00001624 } }
```

- Se ordena por `index`, no por posición.
- Lotes: OpenRouter **no documenta** un máximo. El de OpenAI: 2.048 textos por petición, 8.192 tokens por
  texto y 300.000 tokens en total. Lotes de 64 a 128 trozos de ~400 tokens quedan muy por debajo.
- Existe `openai/text-embedding-3-small`: 0,02 $/M tokens, contexto 8.192, proveedores OpenAI y Azure.
- Errores documentados: 400, 401, 402, 403, 404, 408, 429, 529 (y los generales).
- Lista de modelos: `GET /api/v1/embeddings/models` o `/models?output_modalities=embeddings`.

## 7. Rerank: `POST /api/v1/rerank`

Existe.

```json
{ "model": "cohere/rerank-v3.5", "query": "¿Cuánto cuesta el tinte?",
  "documents": ["Tinte completo: 45 €…", "Mechas: 60 €…", "…"], "top_n": 6 }
```

- Obligatorios: `model`, `query`, `documents` (textos, o `{ text, image }` en modelos multimodales).
  Opcionales: `top_n` (≥ 1), `provider` (mismas preferencias que el chat), `session_id`, `user`.

```json
{ "id": "gen-rerank-…", "model": "cohere/rerank-v3.5", "provider": "Cohere",
  "results": [ { "index": 0, "relevance_score": 0.91, "document": { "text": "Tinte completo: 45 €…" } } ],
  "usage": { "search_units": 1, "total_tokens": 150, "cost": 0.001 } }
```

- `results` viene ordenado por relevancia; `index` apunta a nuestra lista original.
- Sin streaming.
- Modelos (7 hoy) y precio, que el catálogo de la API **no** da (pone `"0"`) y sale de la página web de cada
  modelo el 2026-09-26: `cohere/rerank-v3.5` 0,001 $/búsqueda; `cohere/rerank-4-fast` 0,002 $;
  `cohere/rerank-4-pro` 0,0025 $; `voyageai/rerank-2.5-lite` 0,02 $/M tokens; `qwen/qwen3-reranker-8b`
  0,20 $/M tokens. El coste real, de `usage.cost`.
- **Con ZDR activado, ningún rerank de Cohere tiene endpoint ZDR**: el único hoy es
  `qwen/qwen3-reranker-8b` (Fireworks). El ajuste de rerank tiene que avisarlo o cambiar de modelo.

## 8. Voz (futuro): `POST /api/v1/audio/speech`

Existe, compatible con la API de voz de OpenAI: `model`, `input` (texto), `voice`, `response_format`,
`speed`, `provider` (solo opciones). Devuelve **bytes de audio**, no JSON. `response_format`: solo `mp3` o
`pcm` (por defecto `pcm`, 16 bits). Para mandar una nota de voz de WhatsApp (OGG/Opus) hay que convertir
con ffmpeg. Modelos: `output_modalities=speech` (21 hoy). No se implementa en v1.

## 9. Privacidad: `data_collection` y ZDR

- **OpenRouter** no guarda prompts ni respuestas salvo que la cuenta active el registro privado de entradas
  y salidas o ceda sus datos a cambio de un 1 % de descuento (ambos apagados por defecto). Sí guarda
  metadatos (tokens, latencia…). La guía del negocio debe decir que no los active.
- **`data_collection: "deny"`**: excluye proveedores que guardan datos de forma no transitoria o pueden
  entrenar con ellos. Hay un ajuste equivalente para toda la cuenta en openrouter.ai/settings/privacy
  (separado para modelos de pago y gratis). La API pública no expone la política de cada endpoint.
- **ZDR** (cero retención): el proveedor no guarda nada. Se puede exigir por petición (`provider.zdr: true`),
  por cuenta, por grupo de modelos (Anthropic, OpenAI, Google, SpaceXAI y «el resto»; p. ej. el de OpenAI
  quita los endpoints propios de OpenAI y deja Azure) o por guardarraíl. Todas se suman: la petición solo
  puede endurecer, nunca relajar el ajuste de la cuenta.
- Lista pública de endpoints ZDR: `GET /api/v1/endpoints/zdr` (921 el 2026-09-26). Responde `{ "data": [ … ] }`
  con la misma forma de endpoint que `GET /models/{autor}/{slug}/endpoints` (`{ "data": { "id", …,
  "endpoints": [ … ] } }`): `model_id`, `provider_name`, `tag` («deepinfra/us»), `pricing`, `status`… Un endpoint
  se identifica por `model_id` + `tag` (comprobado en vivo el 2026-09-26).
- ZDR solo se aplica al enrutado de la inferencia, **no a los plugins ni a las herramientas del servidor**
  (búsqueda web…). No usamos ninguno salvo `file-parser`; con `mistral-ocr` el PDF va a Mistral.
- **Transcripción y voz no aceptan `data_collection` ni `zdr` por petición.** Si el ajuste de la cuenta se
  aplica a ellas está **no verificado**. Por eso el modelo de transcripción por defecto es uno cuyos
  proveedores son todos ZDR hoy (`openai/whisper-large-v3-turbo`: DeepInfra y Groq). Si el negocio cambia de
  modelo, Ajustes muestra si todos sus endpoints están en la lista ZDR: pide los endpoints del modelo y la lista
  ZDR, compara por `tag` y nombra los proveedores que faltan. Se guarda 12 h por modelo; sin clave o si
  OpenRouter falla, no se muestra nada (no se sabe).
- Con ZDR activado, hoy: `openai/gpt-5.6-luna` solo por Azure; `google/gemini-3.1-flash-lite` por Google
  Vertex; `openai/text-embedding-3-small` solo por Azure; rerank solo `qwen/qwen3-reranker-8b`.
- Región UE: `eu.openrouter.ai` solo existe para clientes empresa. No se usa.

## 10. Modelos recomendados (2026-09-26)

Son los valores que el asistente guarda en Ajustes > IA como «por defecto» y «recomendados»; se pueden
cambiar. **Los precios no se guardan**: la interfaz los lee de la API al mostrarlos. Los de esta tabla son
los de la tarifa normal del 2026-09-26, en dólares.

| Uso | Modelo | Por qué | Precio hoy | ZDR hoy |
|---|---|---|---|---|
| Chat principal | `openai/gpt-5.6-luna` | Tiene herramientas y pasa el filtro de la API de éxito en llamadas a herramientas ≥ 95 %; índice «agentic» de Artificial Analysis 42,1 (el más alto entre los baratos con dato); texto, imagen y PDF; razonamiento desactivable; 2,5 meses en el catálogo; sin fecha de retirada; proveedores OpenAI, Azure y Bedrock | 0,20 $/M entrada · 1,20 $/M salida · caché 0,02 $/M (lectura) y 0,25 $/M (escritura); con más de 272.000 tokens de prompt, 0,40/1,80 | Sí (Azure) |
| Respaldo (otro proveedor) | `google/gemini-3.1-flash-lite` | También ≥ 95 % en herramientas; admite imagen, PDF, audio y vídeo; razonamiento por defecto «minimal» y no obligatorio; 4,5 meses en el catálogo | 0,25 $/M entrada · 1,50 $/M salida · audio 0,50 $/M · caché 0,025 $/M | Sí (Google Vertex) |
| Visión barata (describir imágenes) | `google/gemini-3.1-flash-lite` | El mismo: barato y con imagen | Igual | Sí |
| Transcripción | `openai/whisper-large-v3-turbo` | El más barato de los que tienen **todos** sus proveedores en ZDR (DeepInfra y Groq); multilingüe | 0,00000333 $/s (≈ 0,0002 $/min) en DeepInfra; 0,0000111 $/s en Groq | Sí, todos |
| Transcripción de respaldo | `mistralai/voxtral-mini-transcribe` | Otro proveedor (Mistral). Solo se usa si todos sus endpoints pasan a ZDR: hoy no se usa (decisión 0018) | 0,00005 $/s (≈ 0,003 $/min); UE 0,000055 $/s | Solo el endpoint `mistral/eu` |
| Embeddings | `openai/text-embedding-3-small` | 1536 dimensiones nativas; las de la base vectorial | 0,02 $/M tokens | Sí (Azure) |
| Rerank (opcional) | `cohere/rerank-v3.5` | Multilingüe y el más barato por búsqueda | 0,001 $/búsqueda (página web del modelo) | No: con ZDR, `qwen/qwen3-reranker-8b` (0,20 $/M) |

- La calidad **en español** no se puede medir con la API: **no verificado**. Antes de fijarlos, probar en
  «Probar agente» con conversaciones y notas de voz reales de la demo.
- `openai/gpt-5.6-luna` tiene moderación de OpenAI (`is_moderated: true`): mensajes delicados pueden dar
  403, y entonces responde el respaldo. No admite `temperature` (se ignora).
- La API muestra modelos más nuevos y baratos (p. ej. `openai/gpt-6-luna`, 0,10/0,50 $, dado de alta el
  2026-09-22) que aún no tienen medido el éxito con herramientas. Se pueden añadir a «recomendados» cuando
  lo tengan.
- Modelos a evitar hoy como predeterminados por su fecha de retirada: `google/gemini-2.5-flash` y
  `google/gemini-2.5-flash-lite` (2026-10-20), `deepseek/deepseek-v3.2` (2026-09-28), la familia
  `qwen/qwen3-*` con fecha 2026-10-09 y `qwen/qwen3-asr-flash-2026-02-10` (2026-10-09).

## 11. Diferencias con la especificación original

- **Cabecera de título**: el nombre actual es `X-OpenRouter-Title`; `X-Title` sigue funcionando.
  `HTTP-Referer` crea una ficha pública salvo que se mande `X-OpenRouter-App-Visibility: hidden`.
- **§5 «Probar clave»**: `/key` da el tope y el gasto de la clave, no el saldo de la cuenta (eso exige una
  clave de gestión). `rate_limit` está obsoleto.
- **§7 Modelos**: `/models/user` existe y filtra por la privacidad **de la cuenta**, no por
  `data_collection` de cada petición. No admite el filtro `supported_parameters`: se filtra en la app. En
  `/models`, filtrar con `supported_parameters=tools` devuelve precios `flex` (observado).
- **§7 Exclusiones**: además de `:free`, `:batch`, `~…` y precios negativos, hay que excluir los de precio 0
  sin `:free` (`openrouter/free`, `stealth/…`). Los negativos son `"-1"` y marcan enrutadores. `:batch` es
  solo para la Batch API. `expiration_date` existe.
- **§7 Precio ×1e6**: correcto para tokens, pero en transcripción por duración el precio es por segundo, en
  rerank no está en la API, y hay precios condicionados (`overrides`).
- **§7 Razonamiento bajo**: `effort: "low"` existe, pero no todos los modelos lo aceptan; se elige según
  `reasoning.supported_efforts`. El razonamiento cuenta dentro de `max_tokens`.
- **§7 Motor**: `session_id` confirmado como clave de enrutado pegajoso para la caché. El coste llega sin
  pedirlo (`usage.include` obsoleto). La respuesta no documenta el proveedor: hace falta
  `X-OpenRouter-Metadata: enabled` o `/generation`. Se propone mandar también `user` (seudónimo).
- **§7 Audio**: el endpoint y su formato son correctos. Los «60 s» son el corte de los proveedores, no un
  parámetro. Que acepte OGG/Opus está **no verificado** por proveedor. No acepta `data_collection` ni `zdr`.
- **§7 PDF**: sin motor explícito, OpenRouter puede usar `mistral-ocr` de pago.
- **§7 Voz futura**: `/audio/speech` devuelve `mp3` o `pcm`, no OGG/Opus: hace falta ffmpeg.
- **§8 Embeddings**: `dimensions` existe; su reenvío al proveedor está **no verificado** (irrelevante con
  1536 nativo). OpenRouter no documenta el máximo por lote; el de OpenAI es 2.048 textos y 300.000 tokens.
- **§8 Rerank**: existe; ningún Cohere es ZDR.
- **§11 `data_collection: "deny"`**: aplicable a chat, embeddings y rerank, no a transcripción ni voz.

## Fuentes

Consultadas el 2026-09-26. Documentación oficial de OpenRouter (versión `.md` de cada página):

- Autenticación: https://openrouter.ai/docs/api_reference/authentication
- Atribución de apps: https://openrouter.ai/docs/app-attribution
- Resumen de la API: https://openrouter.ai/docs/api_reference/overview
- Errores: https://openrouter.ai/docs/api_reference/errors-and-debugging
- Límites y 402/429: https://openrouter.ai/docs/api_reference/limits
- Parámetros: https://openrouter.ai/docs/api_reference/parameters
- Clave actual: https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
- Lista de modelos: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- Modelos del usuario: https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails
- Guía de modelos: https://openrouter.ai/docs/guides/overview/models
- Variantes: https://openrouter.ai/docs/guides/routing/model-variants/overview y https://openrouter.ai/docs/guides/routing/model-variants/free
- Alias `~…-latest`: https://openrouter.ai/docs/guides/routing/routers/latest-resolution
- Tarifas de servicio: https://openrouter.ai/docs/guides/features/service-tiers
- Chat: https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion
- Herramientas: https://openrouter.ai/docs/guides/features/tool-calling
- Respaldo de modelos: https://openrouter.ai/docs/guides/routing/model-fallbacks
- Enrutado de proveedores: https://openrouter.ai/docs/guides/routing/provider-selection
- Razonamiento: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- Caché del prompt y `session_id`: https://openrouter.ai/docs/guides/best-practices/prompt-caching
- Uso y coste: https://openrouter.ai/docs/cookbook/administration/usage-accounting
- `user`: https://openrouter.ai/docs/cookbook/administration/user-tracking
- Metadatos del enrutado: https://openrouter.ai/docs/guides/features/router-metadata
- Datos de una generación: https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation
- Imágenes: https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
- PDF: https://openrouter.ai/docs/guides/overview/multimodal/pdfs
- Audio en el chat: https://openrouter.ai/docs/guides/overview/multimodal/audio
- Transcripción: https://openrouter.ai/docs/guides/overview/multimodal/stt y https://openrouter.ai/docs/api/api-reference/stt/create-transcription
- Voz: https://openrouter.ai/docs/guides/overview/multimodal/tts y https://openrouter.ai/docs/api/api-reference/tts/create-speech
- Embeddings: https://openrouter.ai/docs/api_reference/embeddings y https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request
- Rerank: https://openrouter.ai/docs/api/api-reference/rerank/submit-a-rerank-request
- ZDR: https://openrouter.ai/docs/guides/features/zdr
- Datos que guarda OpenRouter: https://openrouter.ai/docs/guides/privacy/data-collection
- Registro de los proveedores: https://openrouter.ai/docs/guides/privacy/provider-logging
- Moneda (dólares): https://openrouter.ai/docs/faq

API en vivo (2026-09-26): https://openrouter.ai/api/v1/models (sin filtros, `?output_modalities=all`,
`?supported_parameters=tools`, `?supported_parameters=tools&min_tool_success_rate=0.95&max_price=0.5`),
https://openrouter.ai/api/v1/models/user (401 sin clave), https://openrouter.ai/api/v1/models/{id}/endpoints
y https://openrouter.ai/api/v1/endpoints/zdr.

Precios de rerank (páginas de modelo, 2026-09-26): https://openrouter.ai/cohere/rerank-v3.5,
https://openrouter.ai/cohere/rerank-4-fast, https://openrouter.ai/cohere/rerank-4-pro,
https://openrouter.ai/voyageai/rerank-2.5-lite, https://openrouter.ai/qwen/qwen3-reranker-8b.

OpenAI (límites de embeddings y 1536 dimensiones):
https://developers.openai.com/api/reference/resources/embeddings/methods/create y
https://developers.openai.com/api/docs/guides/embeddings
