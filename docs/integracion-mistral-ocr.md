# Integración con Mistral OCR

Referencia técnica de lo que la app usa de Mistral: el OCR de PDF escaneados en la ingesta del conocimiento
(§8 de la especificación original: «PDF escaneado: Mistral OCR si hay clave; si no, avisar»). Verificado el
**2026-09-26** contra la documentación oficial de Mistral (guía del OCR, referencia de la API, fichas de
modelos, precios e inferencia regional) y contra los tipos del SDK oficial `@mistralai/mistralai` 2.7.0, que
se generan desde su especificación OpenAPI. Lo que no se ha podido comprobar va marcado **«no verificado»**.
Las fuentes están al final.

Por qué este documento: el cliente es nuestro (`src/lib/mistral/`, `fetch` sin SDK), su URL base sale de
`MISTRAL_BASE_URL` para que las pruebas apunten al simulador (`e2e/mocks/`) y la clave es opcional. El
cliente y el simulador se construyen con este contrato: lo que no esté aquí no se usa ni se inventa.

## Lo esencial

- Un único endpoint: `POST {MISTRAL_BASE_URL}/v1/ocr`, con `MISTRAL_BASE_URL` = `https://api.mistral.ai` por
  defecto. JSON de entrada y de salida.
- Modelo: `mistral-ocr-latest`, que hoy apunta a **OCR 4.1** (`mistral-ocr-4-1`, publicado el 2026-07-16).
- El PDF se manda como **data URL en base64** (`data:application/pdf;base64,…`) dentro de `document_url`: no
  hace falta que sea público ni subirlo antes.
- La respuesta trae **una entrada por página** (`pages[].index`, que empieza en 0, y `pages[].markdown`): es
  justo lo que necesita la ingesta («Markdown con páginas»).
- Límites documentados: **50 MB y 1.000 páginas** por documento.
- Precio: **4 $ por 1.000 páginas** con OCR 4.1 (5 $ con anotaciones, que no usamos). La respuesta no trae
  coste, solo `usage_info.pages_processed`: no se guarda ningún precio en el código.
- La clave va cifrada en `integration_settings` y solo se descifra en el servidor, como la de OpenRouter.

## Cuándo se usa

- Solo en PDF **sin capa de texto** (escaneados). Primero se intenta extraer el texto con el lector de PDF; si
  sale muy poco texto por página, se considera escaneado. El umbral (p. ej. menos de ~50 caracteres por
  página de media) es una decisión nuestra, **no verificada**, en una constante con nombre.
- Con clave de Mistral: paso «extrayendo» con OCR. Sin clave: el documento queda en error con el aviso
  «Este PDF es una imagen escaneada. Añade una clave de Mistral OCR en Ajustes > IA para leerlo».
- Probar la clave en Ajustes: `GET {MISTRAL_BASE_URL}/v1/models` con la clave (aparece en la documentación
  de inferencia regional). 200 = válida.
- La documentación admite también imágenes, DOCX, PPTX, XLSX, EPUB y otros formatos. No lo usamos: DOCX, XLSX
  y CSV se leen en local, sin coste.

## Petición

```http
POST /v1/ocr
Authorization: Bearer <clave>
Content-Type: application/json

{
  "model": "mistral-ocr-latest",
  "document": { "type": "document_url", "document_url": "data:application/pdf;base64,<pdf>", "document_name": "tarifas.pdf" },
  "include_image_base64": false,
  "extract_header": true,
  "extract_footer": true,
  "include_blocks": false
}
```

| Campo | Tipo | Uso en la app |
|---|---|---|
| `model` | texto, obligatorio | `mistral-ocr-latest` por defecto; configurable por si hay que fijar una versión |
| `document` | obligatorio, una de tres formas | Ver abajo |
| `pages` | lista de enteros o texto (`"0-19"`, `"0,2-4"`), empezando en 0 | Para trocear documentos largos en varios pasos |
| `include_image_base64` | booleano | `false`: no necesitamos las imágenes y engordan la respuesta |
| `image_limit`, `image_min_size` | enteros | No se usan |
| `table_format` | `"markdown"` o `"html"`; sin enviar = tablas dentro del Markdown | **No se envía**: así las tablas quedan en el Markdown de la página y el troceado las ve |
| `extract_header`, `extract_footer` | booleanos, `false` por defecto | `true`: saca las cabeceras y pies repetidos a campos aparte y los quita del Markdown, para que no ensucien los fragmentos (OCR 2512 o posterior) |
| `include_blocks` | booleano | `false`: cajas por párrafo, no las necesitamos (OCR 4 o posterior). La referencia de la API no deja claro su valor por defecto (**no verificado**), por eso se envía explícito |
| `confidence_scores_granularity` | `"page"`, `"block"` o `"word"` | No se envía (sin puntuaciones de confianza) |
| `bbox_annotation_format`, `document_annotation_format`, `document_annotation_prompt` | — | No se usan (son las «anotaciones», de pago aparte) |

Las tres formas de `document`:

| Forma | Campos | Cuándo |
|---|---|---|
| URL del documento | `{ "type": "document_url", "document_url": "<URL pública o data URL>", "document_name"?: "…" }` | La normal: data URL en base64 |
| Archivo ya subido | `{ "type": "file", "file_id": "<id>" }` | Documentos grandes troceados por páginas (ver abajo). Está en los tipos del SDK; la guía usa en su lugar la URL firmada del archivo |
| Imagen | `{ "type": "image_url", "image_url": "<URL o data:image/…;base64,…>" }` | No se usa |

Una URL pública **no** se usa aunque se pueda: los documentos del negocio no se publican nunca (§11).

## Respuesta

```json
{
  "pages": [
    {
      "index": 0,
      "markdown": "# Tarifas 2026\n\n| Servicio | Precio |\n|---|---|\n| Corte | 25 € |\n\n![img-0.jpeg](img-0.jpeg)",
      "images": [ { "id": "img-0.jpeg", "top_left_x": 294, "top_left_y": 222, "bottom_right_x": 943, "bottom_right_y": 635 } ],
      "tables": [],
      "hyperlinks": [],
      "header": "Peluquería Ejemplo",
      "footer": "Página 1",
      "dimensions": { "dpi": 200, "height": 2200, "width": 1700 }
    }
  ],
  "model": "mistral-ocr-4-1",
  "document_annotation": null,
  "usage_info": { "pages_processed": 1, "doc_size_bytes": 102400 }
}
```

- `pages[].index` empieza en **0**: la página que se guarda en el fragmento es `index + 1`.
- `pages[].markdown` es el texto de la página en Markdown. Las imágenes aparecen como marcadores
  `![img-0.jpeg](img-0.jpeg)` y, si se pide `table_format`, las tablas como `[tbl-3.html](tbl-3.html)`: los
  marcadores de imagen se quitan antes de trocear.
- `header` y `footer` solo vienen con `extract_header`/`extract_footer`; se descartan.
- `blocks` y `confidence_scores` solo vienen si se piden.
- `model` dice qué versión se usó de verdad: se guarda en el documento, junto con
  `usage_info.pages_processed`, para trazabilidad y para mostrar el consumo.
- El SDK marca `tables`, `hyperlinks`, `header`, `footer` y `doc_size_bytes` como opcionales: el cliente no
  debe fallar si faltan.

## Documentos largos y tiempo máximo

- La documentación no da tiempos de respuesta (**no verificado**). Un PDF de más de 100 páginas en una sola
  llamada puede pasar del `maxDuration` de una función en Vercel. Por eso el OCR va por pasos en la cola: cada
  paso procesa un rango con `pages` (p. ej. 20 páginas) y guarda su Markdown; el siguiente paso sigue donde lo
  dejó.
- Con data URL, cada paso volvería a mandar el PDF entero (en base64 ocupa un tercio más). Para documentos
  grandes se sube **una vez** con la API de archivos y cada paso usa el mismo archivo:
  - `POST /v1/files` (multipart) con `purpose=ocr` y el archivo → devuelve el `id`.
  - OCR con `{ "type": "file", "file_id": "<id>" }`, o con la URL firmada de
    `GET /v1/files/{id}/url?expiry=24` (horas) dentro de `document_url`, que es lo que muestra la guía.
  - Al terminar (o si falla del todo), `DELETE /v1/files/{id}`.
- El tamaño máximo del cuerpo JSON con base64 no está documentado (**no verificado**). Umbral propuesto para
  pasar a la API de archivos: más de ~10 MB o más de 20 páginas, en constantes con nombre.
- Límites de peticiones de la cuenta: **no verificados** para el OCR. Un 429 se reintenta con espera, como el
  resto de trabajos de la cola.

## Modelos y precio

| Modelo | Id | Alias | Fecha | Precio (1.000 páginas) |
|---|---|---|---|---|
| OCR 4.1 | `mistral-ocr-4-1` | `mistral-ocr-4`, `mistral-ocr-latest` | 2026-07-16 | 4 $ (5 $ con anotaciones) |
| OCR 4.0 | `mistral-ocr-4-0` | — | 2026-06-23 | 4 $ (5 $ con anotaciones) |
| OCR 2512 | `mistral-ocr-2512` | — | **no verificado** | **no verificado** (es el modelo que sale en las respuestas de ejemplo de la guía) |

- El procesamiento por lotes (`/v1/batch`) cuesta la mitad, pero es asíncrono y no lo usamos.
- `mistral-ocr-latest` puede cambiar de modelo, y de precio, sin avisar. Por eso el modelo es configurable y se
  guarda el `model` de cada respuesta.
- Precios nunca en el código: la pantalla muestra las páginas procesadas; si se quiere un coste estimado, sale
  de un precio por 1.000 páginas editable en Ajustes (como las tarifas de WhatsApp).

## Regiones y privacidad

- Hay tres bases: `https://api.mistral.ai` (global, sin ubicación garantizada), `https://api.eu.mistral.ai`
  (UE) y `https://api.us.mistral.ai` (EE. UU.). Las regionales cuestan un 10 % más (la documentación lo dice
  para tokens; para el precio por página es **no verificado**).
- Las regionales **no tienen la API de archivos** (ni lotes ni agentes), y solo sirven los modelos alojados en
  esa región: que el OCR esté disponible en la UE es **no verificado** (se comprueba con `GET /v1/models`
  contra esa base).
- Consecuencia: un negocio que quiera el proceso en la UE puede poner `MISTRAL_BASE_URL=https://api.eu.mistral.ai`
  si el modelo está allí, pero entonces solo sirve la data URL en base64 y los documentos grandes se procesan
  en un solo paso o se rechazan con un aviso.
- Qué guarda Mistral de los documentos y durante cuánto tiempo: **no verificado** en esta revisión. Hay que
  comprobarlo antes de usarlo con datos personales y reflejarlo en el contrato de encargo del tratamiento.

## Alternativa sin segunda clave

OpenRouter tiene un motor `mistral-ocr` para PDF (2 $ por 1.000 páginas; 2,2 $ fijado a EE. UU.) dentro de
`/api/v1/chat/completions`. Solo devuelve el resultado como anotaciones de una respuesta de chat, no como
Markdown por páginas: extraer el texto completo de un documento largo por esa vía es **no verificado**. La
especificación pide la clave de Mistral aparte; esto queda anotado por si se quiere evitar esa segunda clave.
Ver `docs/integracion-openrouter.md`.

## Errores

- Los códigos y el formato del cuerpo de error del OCR no están en la guía (**no verificado**; lo esperable
  con una clave inválida es 401). El cliente trata cualquier respuesta no 2xx como error, guarda el estado
  HTTP y un mensaje genérico, y nunca registra la clave ni el contenido del documento.
- Documento de más de 50 MB o de más de 1.000 páginas: se rechaza en la app antes de llamar, con aviso.
- 429 y 5xx: reintento con espera en la cola. 4xx restantes: error permanente del documento, visible en su
  estado.

## Pruebas

- Las pruebas nunca llaman a Mistral. El simulador responde a `POST /v1/ocr` (y a `/v1/files` si se usa) con
  la forma de la respuesta de arriba, y el cliente acepta un `fetch` inyectable.
- Casos: PDF pequeño en una llamada, documento troceado por `pages` en varios pasos, respuesta sin campos
  opcionales, 401, 429 con reintento y PDF por encima de los límites.

## Fuentes

Consultadas el 2026-09-26.

- Guía del OCR (entradas, parámetros, respuesta, API de archivos, límites, formatos): https://docs.mistral.ai/studio/document-processing/basic_ocr
- Referencia de la API del OCR: https://docs.mistral.ai/api/endpoint/ocr
- Ficha de OCR 4.1 (id, alias, fecha, precio): https://docs.mistral.ai/models/ocr-4-1
- Ficha de OCR 4.0: https://docs.mistral.ai/models/ocr-4-0
- Precios de la API (OCR 4.1, lotes a mitad de precio): https://mistral.ai/pricing/api
- Inferencia regional (bases UE y EE. UU., recargo, limitaciones, `GET /v1/models`): https://docs.mistral.ai/inference/regional-inference
- SDK oficial 2.7.0, tipos generados de la API (`OCRRequest`, `OCRResponse`, `OCRPageObject`, `OCRUsageInfo`, `DocumentURLChunk`, `FileChunk`, lista de servidores): https://unpkg.com/@mistralai/mistralai@2.7.0/esm/models/components/ y https://unpkg.com/@mistralai/mistralai@2.7.0/esm/lib/config.d.ts
- Motor `mistral-ocr` de OpenRouter: https://openrouter.ai/docs/guides/overview/multimodal/pdfs
