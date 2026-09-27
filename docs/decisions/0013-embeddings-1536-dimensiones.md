# 0013 · Embeddings de 1536 dimensiones fijas

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

La búsqueda por significado del conocimiento guarda, para cada fragmento de documento, su embedding: una lista
de números que representa lo que dice. La columna que los guarda tiene un tamaño fijo, y el índice vectorial
solo compara listas del mismo tamaño. Cambiar ese tamaño más adelante obliga a migrar la columna y a
recalcular todo el conocimiento de cada negocio. Además, la demo trae los embeddings ya calculados en el
repositorio para que la búsqueda funcione sin clave. Había que fijar el tamaño y el modelo por defecto.

Datos comprobados el 26-09-2026:

- `openai/text-embedding-3-small` en OpenRouter: 1536 dimensiones de forma nativa, 0,02 $ por millón de
  tokens y hasta 8.192 tokens por texto. Con «Sin retención de datos» activado, hoy solo lo sirve Azure
  (`docs/integracion-openrouter.md`, §6 y §9).
- OpenRouter acepta el campo `dimensions`, pero que lo pase a todos los proveedores está **no verificado**: la
  app comprueba siempre que el resultado tiene 1536 números (`docs/integracion-openrouter.md`, §6).
- libSQL guarda el vector en `F32_BLOB(1536)` (ver 0024: hoy la base es Postgres, con `halfvec(1536)`). Con 1536 dimensiones, el índice vectorial con los ajustes por
  defecto ocupa unos 708 KiB por fragmento; con `compress_neighbors=float8` y `max_neighbors=20`, unos 36 KiB.
  La compresión `float1bit` no sirve con los embeddings de OpenAI (`docs/busqueda-hibrida.md`, §2 y §9).
- En Postgres, `halfvec(1536)` ocupa 3.080 bytes por vector, y el índice HNSW admite `halfvec` hasta 4.000
  dimensiones (`vector`, hasta 2.000) (`docs/busqueda-hibrida.md`, §8).
- Los embeddings de la demo se guardan con una clave que depende del modelo, las dimensiones y el texto: si
  cambia cualquiera, no se usa un embedding equivocado (`docs/busqueda-hibrida.md`, §7).

## Opciones consideradas

- **Tamaño distinto por base de conocimiento:** varias columnas o índices por tamaño, y consultas que dependen
  del modelo; mucha complejidad para un negocio pequeño.
- **Un modelo de más dimensiones:** más espacio por fragmento y un índice más pesado, sin una mejora comprobada
  en español.
- **1536 dimensiones fijas para toda la instalación.**

## Decisión

- El tamaño es **1536** en toda la instalación: `F32_BLOB(1536)` ahora y `halfvec(1536)` en Postgres (ver 0024: ya
  solo `halfvec(1536)`).
- Modelo por defecto: `openai/text-embedding-3-small`. Cada base de conocimiento guarda su modelo y sus
  dimensiones; cambiar el modelo obliga a reindexar la base entera, de forma atómica (`index_version`).
- Se pide `dimensions: 1536` cuando el modelo lo admite, y un resultado de otro tamaño se rechaza con un error
  claro en español.
- El índice vectorial se crea con `compress_neighbors=float8` y `max_neighbors=20` (ver 0024: hoy es un índice HNSW
  de pgvector), y la columna del embedding nunca se lee en las consultas normales.
- La demo trae los embeddings calculados con el modelo por defecto (`seed/fixtures/embeddings.json`), y
  `pnpm seed:embeddings` los vuelve a calcular con clave.

## Consecuencias

- Gana: el mismo tamaño vale en libSQL y en Postgres; el índice cabe en el plan gratuito de Turso (ver 0024) para el
  tamaño de un negocio pequeño; la demo funciona sin clave.
- Acepta: solo se pueden usar modelos que den 1536 dimensiones; los demás se rechazan al elegirlos.
- Acepta: cambiar el tamaño en el futuro sería una decisión nueva con migración de la columna y reindexado de
  todo el conocimiento.
- Acepta: la calidad de la búsqueda en español con este modelo está **no verificada**; se comprueba con la demo
  en la fase 4.
