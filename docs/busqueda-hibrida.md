# Búsqueda híbrida del conocimiento

Referencia técnica de la búsqueda del conocimiento (§8 de la especificación original): vectores con pgvector y texto
con la búsqueda de Postgres, cómo encaja con Drizzle, la fusión RRF, el troceado y los embeddings precalculados de la
demo. Desde la fase 8 la base es Postgres en todas partes (decisión 0024): la integrada (PGlite) en local y en las
pruebas, y Supabase al publicar. RRF, troceado, embeddings, pgvector y PostgreSQL se verificaron el **2026-09-26**;
PGlite, Supabase y los ejemplos de palabras, el **2026-09-27** (los ejemplos, ejecutados en PGlite 0.5.8 con la
misma configuración que la migración). Lo que no se ha podido comprobar va marcado **«no verificado»**. Las fuentes
están al final.

Por qué este documento: la búsqueda va detrás de dos interfaces (`VectorSearch` y `TextSearch`, en
`src/server/adapters/`), que con la migración a medida de las extensiones son el único sitio con SQL propio de la
búsqueda. Aquí está el contrato con el que se construyen y los límites que hay que respetar para que el mismo código
funcione en la base integrada y en Supabase.

## Lo esencial

- **El mismo Postgres en todas partes:** la base integrada es PostgreSQL 18.3 (PGlite 0.5.8) con pgvector 0.8.1;
  Supabase ofrece Postgres 17 (su versión de pgvector se mira en el proyecto: hace falta la 0.8.0 o posterior,
  **a comprobar** en el primero real). Las extensiones `vector` y `unaccent` van en el esquema `extensions`, como en
  Supabase.
- **Embeddings en `halfvec(1536)`** (media precisión: 3.080 bytes por vector) con un índice **HNSW**
  `halfvec_cosine_ops`. Con pocos fragmentos elegibles (hasta 5.000), búsqueda exacta en un CTE `MATERIALIZED`; con más,
  el índice en una transacción de solo lectura con `hnsw.ef_search = 200` y `hnsw.iterative_scan = relaxed_order`,
  para que el filtro por base no deje menos resultados de los pedidos, y un reordenado final.
- **Texto en una columna generada** `search_vector` (`tsvector`) con la configuración `es_unaccent`: sin tildes ni
  mayúsculas y **con las raíces del español** («tintes» y «tinte» dan lo mismo), con un índice GIN. La consulta es un
  OR de palabras clave y de su otro número (singular o plural), pasado siempre como parámetro a
  `websearch_to_tsquery`, que nunca da error de sintaxis, y se ordena con `ts_rank_cd`.
- **Nada que reconstruir a mano:** los índices apuntan a la propia fila (no hay `rowid` que cambie) y la columna del
  texto la calcula Postgres en cada `INSERT` y `UPDATE`. `TextSearch.rebuild()` no hace nada; `VectorSearch.rebuild()`
  es un `REINDEX INDEX` del índice HNSW.
- Drizzle: la columna `halfvec`, la columna generada y los dos índices van en el esquema (`pg-core`); solo las
  extensiones y `es_unaccent` van en una migración a medida. **Nunca `drizzle-kit push`**.
- La base integrada no guarda el `search_path`: la app ejecuta `SET search_path TO public, extensions` al abrirla, o
  `halfvec`, `<=>` y `halfvec_cosine_ops` no existen.
- Fusión RRF con k = 60: cada fragmento suma `1 / (60 + posición)` por cada lista en la que aparece.

## 1. Dónde funciona cada pieza

| Entorno | pgvector (`halfvec`, HNSW, `iterative_scan`) | `unaccent` y `es_unaccent` |
|---|---|---|
| Base integrada (`data/pglite`) y pruebas de Vitest (en memoria) | Sí: pgvector 0.8.1, con `@electric-sql/pglite-pgvector` 0.0.9 | Sí: `unaccent` viene con PGlite |
| Pruebas de Playwright (`data/e2e-*pglite`) | Sí, la misma base integrada | Sí |
| Supabase | Sí; la versión de pgvector, **a comprobar** en el proyecto | Sí: las dos extensiones se crean en `extensions` |

Cómo se ha comprobado: con los paquetes instalados, `CREATE EXTENSION … WITH SCHEMA extensions`, la columna generada
con índice GIN, `halfvec(1536)` con HNSW y `SET LOCAL hnsw.iterative_scan = relaxed_order` dentro de una transacción
funcionan en PGlite; y las pruebas del proyecto (`src/db/db.test.ts`, `src/server/adapters/search.test.ts`) lo
comprueban en cada ejecución. En Supabase se comprueba al publicar (fase 8).

## 2. Vectores con pgvector

### La columna y el índice

- `kb_chunks.embedding` es `halfvec(1536)`: media precisión, `2 · 1536 + 8` = 3.080 bytes por vector, la mitad que
  `vector`. HNSW indexa `halfvec` hasta 4.000 dimensiones (`vector`, hasta 2.000). Vacía (`NULL`) hasta que hay clave.
- La columna fija la dimensión; además la app comprueba antes de escribir y de buscar que son 1536 números finitos
  (`assertValidEmbedding`), con un error claro en español.
- El índice, `kb_chunks_embedding_idx`: `USING hnsw (embedding halfvec_cosine_ops)`. Lo genera Drizzle desde el
  esquema.
- Los vectores `NULL` no entran en el índice (ni los de ceros, con la distancia coseno): un fragmento sin embedding
  (la demo sin clave) no rompe nada.
- La distancia es la del coseno, con el operador `<=>`: de 0 (iguales) a 2 (opuestos). La similitud que se usa en
  los umbrales es `1 − distancia`; un negativo minúsculo por redondeo cuenta como 0. Los embeddings de OpenAI vienen
  normalizados, así que coseno y producto escalar ordenan igual.
- La búsqueda nunca devuelve los embeddings: solo el id del fragmento y su similitud. Ninguna consulta lee la fila
  entera de `kb_chunks` (arrastraría 3 KB por fragmento).

### Qué hace el adaptador (`PgVectorSearch`)

1. Cuenta los fragmentos elegibles: los de las bases del agente, en su versión del índice en uso (`index_version`) y
   con embedding.
2. Hasta **5.000** (una constante con nombre, **no medido**): búsqueda exacta. Calcula la distancia de todos en un CTE
   `MATERIALIZED` (así Postgres no la cambia por el índice aproximado), aplica el filtro antes del `LIMIT` y ordena.
3. Con más: el índice HNSW, en una transacción propia de solo lectura con `hnsw.ef_search = 200` y
   `hnsw.iterative_scan = relaxed_order` puestos con `SET LOCAL` (por `set_config(…, true)`), que duran solo esa
   transacción. Con el filtro, la búsqueda iterativa sigue recorriendo el índice hasta tener los resultados pedidos o
   llegar a `hnsw.max_scan_tuples` (20.000 por defecto). En orden relajado los resultados pueden salir algo
   desordenados: se toman en un CTE `MATERIALIZED` y se vuelven a ordenar fuera por `distance + 0` (sin el `+ 0`,
   Postgres 17 o posterior se fiaría del orden del CTE y no reordenaría).
4. Si el índice deja menos de los pedidos y hay más elegibles, se completa con la búsqueda exacta.

Por qué `SET LOCAL` dentro de una transacción: con el pooler de Supabase en modo transacción (el de Vercel), cada
transacción puede ir por una conexión distinta del servidor, y un `SET` de sesión se aplicaría a otra consulta o se
perdería. Es de solo lectura (`accessMode: "read only"`), así que no toma el candado de escritura de la base
(decisión 0024): las búsquedas no esperan a las escrituras.

`hnsw.ef_search` (40 por defecto) limita cuántos candidatos guarda la búsqueda aproximada: se sube a 200 para pedir
40 resultados con filtro. `hnsw.iterative_scan` existe desde pgvector **0.8.0**; sus valores son `off` (por
defecto), `strict_order` y `relaxed_order` (mejor recall; se reordena después).

## 3. Texto con la búsqueda de Postgres

### La configuración `es_unaccent`

La crea la migración a medida `drizzle/0000_extensions.sql`, antes que las tablas, sin repetirse si ya existe:

```sql
CREATE TEXT SEARCH CONFIGURATION public.es_unaccent ( COPY = pg_catalog.spanish );
ALTER TEXT SEARCH CONFIGURATION public.es_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH extensions.unaccent, pg_catalog.spanish_stem;
```

- Es el ejemplo oficial de `unaccent` (hecho con `french`) cambiado a `spanish`: primero quita tildes y después saca
  la raíz. Solo se cambian `hword`, `hword_part` y `word`, los tipos de palabra con letras no ASCII, como en el
  ejemplo; las palabras sin tildes van directas a la raíz.
- Ejemplos comprobados: «tinte» y «tintes» → `tint`; «reserva», «reservas», «reservar» y «reservé» → `reserv`;
  «corte», «cortes» y «cortar» → `cort`; «depilación» y «depilacion» → `depilacion`; «autobús» y «autobus» →
  `autobus`; «Peluquería» → `peluqueri`.
- Dos límites, porque la tilde se quita antes de sacar la raíz: «cancelación» da `cancelacion` y «cancelaciones»,
  `cancel` (el lematizador solo reconoce la terminación con tilde); y una palabra que sin su tilde o su eñe es una
  palabra vacía del español desaparece («uña» se queda en «una»). Por lo primero, el adaptador busca también el otro
  número de cada palabra (ver «Construir la consulta»); lo segundo se acepta.

### La columna y el índice

- `kb_chunks.search_vector`: `tsvector GENERATED ALWAYS AS (to_tsvector('public.es_unaccent', coalesce(title, '') ||
  ' ' || coalesce(section, '') || ' ' || coalesce(content, ''))) STORED`, con el índice GIN `kb_chunks_search_vector_idx`.
  Postgres la escribe con cada `INSERT` y `UPDATE` del fragmento: la app nunca la toca.
- El texto de los documentos y de sus fragmentos se guarda sin el carácter nulo (NUL), que Postgres no admite y que a
  veces trae un PDF o una web (`src/server/knowledge/store.ts`); el que se escribe o se pega en la pantalla pasa por
  `src/server/storable-text.ts`, que además cambia la mitad suelta de un carácter compuesto por «�».
- **Por qué no `unaccent()` en la columna generada**: una expresión generada solo puede usar funciones `IMMUTABLE`, y
  `unaccent()` está declarada `STABLE` (depende del diccionario). `to_tsvector` con la configuración escrita sí vale: es
  lo que usa la documentación de PostgreSQL en su ejemplo de columna generada. Contrapartida: si algún día se cambia
  `es_unaccent`, los `tsvector` guardados no se recalculan solos; hay que forzarlo (por ejemplo, reprocesando las
  bases).

### Construir la consulta desde lo que escribe el cliente

`websearch_to_tsquery` une las palabras sueltas con `&` (exige todas), así que no se usa tal cual: la app le pasa las
palabras ya limpias unidas con ` or `, que entiende como OR. Nunca da error de sintaxis. Lo hace `buildFtsQuery()` de
`src/server/adapters/text-search.ts`:

1. Normalizar (NFKC y minúsculas) y quedarse solo con tiradas de letras y números: comillas y guiones no llegan (en
   `websearch_to_tsquery`, `-` es NOT).
2. Quitar las palabras vacías del español (una lista en el código: «de», «la», «que», «el», «en», «y»…) y las de menos
   de 2 caracteres: en un OR, «de» coincidiría con casi todo y llenaría los 40 resultados de ruido. La lista se compara
   sin tildes pero conservando la «ñ». `es_unaccent` quita además su propia lista.
3. Quitar las repetidas y quedarse con 12 como mucho.
4. Añadir el otro número de cada palabra (el plural de «uña» y de «cancelación»; el singular de «cancelaciones»), por
   los límites de §3.
5. Unirlas con ` or ` y pasarlo **siempre como parámetro**, nunca pegado al SQL. Si no queda ninguna, no se consulta.

La consulta ordena con `ts_rank_cd` (más alto cuanto mejor) y filtra por las bases del agente antes del `LIMIT`, así
que el filtro es exacto. Para RRF solo cuenta la posición, no el valor.

## 4. Drizzle con Postgres

Versiones instaladas: `drizzle-orm` 0.45.2 y `drizzle-kit` 0.31.10 (dialecto `postgresql`). Existe una 1.0 en
«release candidate» y la web de Drizzle ya la documenta; mandan la versión de `package.json` y sus tipos. No se usan
versiones candidatas (`docs/security.md`).

- **En el esquema** (`src/db/schema/knowledge.ts`): `halfvec("embedding", { dimensions: 1536 })` de `pg-core`; la
  columna `search_vector` con un tipo propio (`customType` que devuelve `tsvector`) y `generatedAlwaysAs(…)`; el índice
  `.using("hnsw", t.embedding.op("halfvec_cosine_ops"))` y el GIN. `drizzle-kit generate` los lleva a la migración
  normal (`drizzle/0001_initial.sql`).
- **A medida** (`drizzle/0000_extensions.sql`, creada con `pnpm db:generate --custom --name extensions`): el esquema
  `extensions`, las extensiones `vector` y `unaccent` y `es_unaccent`, cada sentencia separada por
  `--> statement-breakpoint` (el migrador parte el archivo por esa marca). Tiene que ir antes que las tablas.
- **El migrador** de Drizzle (`drizzle-orm/postgres-js/migrator` en Supabase, `drizzle-orm/pglite/migrator` en la base
  integrada) anota cada migración aplicada en `drizzle.__drizzle_migrations`. **Nunca `drizzle-kit push`**: cambia la
  base sin dejar migración.
- El vector de la consulta se pasa como parámetro (`'[…]'::halfvec(1536)`); la dimensión sale de la constante del
  producto (`EMBEDDING_DIMENSIONS`), nunca de fuera.

## 5. Fusión RRF y resultado

1. Normalizar la consulta y construir la consulta de texto (§3).
2. Con clave de OpenRouter: embedding de la consulta (1536, validado) y **40 resultados vectoriales**. Sin
   clave, esta lista queda vacía y la búsqueda es solo de texto (requisito de la demo).
3. **40 resultados de texto** con la búsqueda de Postgres.
4. Los resultados por significado con una similitud por debajo de **0,2** se descartan antes de mezclar: la búsqueda
   vectorial devuelve los más cercanos aunque no se parezcan en nada, y rellenarían la respuesta de ruido.
5. **RRF con k = 60** (Cormack, Clarke y Büttcher, SIGIR 2009): cada fragmento suma `1 / (60 + posición)` por
   cada lista en la que aparece, con la posición empezando en 1. Ejemplo: 1.º en vectores y 3.º en texto =
   1/61 + 1/63 ≈ 0,0323; solo 1.º en una lista = 1/61 ≈ 0,0164. No hay que normalizar las puntuaciones de
   cada lista, porque solo cuenta la posición. Empates: primero el de mejor posición vectorial, después por
   id, para que el orden sea estable en las pruebas.
6. Los **8 mejores**; con rerank activado (interruptor de toda la instalación en Ajustes > IA, [AJU-04];
   `POST /api/v1/rerank`, ver `docs/integracion-openrouter.md`) se reordenan y se quedan **6**. Si el rerank
   falla, se devuelven los 8 de RRF sin reordenar. Con ZDR solo se reordena con un modelo sin retención (hoy
   `qwen/qwen3-reranker-8b`); con otro, Ajustes > IA lo avisa y no se reordena.
7. **`SIN_RESULTADOS`** si nada es relevante. La puntuación RRF no sirve para decidirlo (es relativa). Basta
   con que aparezca alguna palabra de la pregunta (las palabras vacías no se buscan, [CON-16]); sin ninguna,
   decide la similitud del mejor resultado vectorial (1 − distancia, al menos **0,3**). Si se reordenó, decide
   el `relevance_score` del primero (al menos 0,1). Los umbrales son **no verificados** y se calibran con la demo; van en
   constantes con nombre (decisión 0021).
8. Respuesta de unos 3.500 tokens como máximo, en fragmentos numerados con título, sección y página, y lo
   usado se guarda en `message_retrievals`.

Referencia: el ejemplo de búsqueda híbrida de Supabase usa RRF con `rrf_k = 50` y `websearch_to_tsquery`
(que exige todas las palabras); nosotros usamos k = 60, como el artículo original y el valor por defecto de
Elasticsearch, y consultas OR.

## 6. Troceado y estimación de tokens

- Parámetros de la especificación: por encabezados, unos 400 tokens (entre 150 y 600), 60 de solape, sin
  partir filas de tabla, con el prefijo «Documento: título > sección». Son valores prudentes: el troceado por
  defecto de la búsqueda de archivos de OpenAI es de 800 tokens con 400 de solape (mínimo 100, máximo 4.096,
  solape no mayor que la mitad).
- `text-embedding-3-small` admite hasta 8.192 tokens por texto y usa el tokenizador `cl100k_base`: un trozo de
  600 tokens con prefijo queda muy lejos del límite.
- **Estimar tokens sin tokenizador.** La regla de 4 caracteres por token es la de OpenAI para inglés. En
  español salen más tokens por carácter (**no verificado** con una fuente oficial). Propuesta: `Math.ceil(
  caracteres / 3.5)` en una constante con nombre, que se queda corto antes por arriba que por abajo; así los
  topes (30.000 tokens de archivos de contexto, 3.500 de respuesta) se cumplen con margen.
- Calibrar con datos reales: la respuesta de embeddings trae `usage.prompt_tokens` (ver
  `docs/integracion-openrouter.md`); caracteres del lote entre tokens da la proporción real, que se puede
  registrar en la ingesta para ajustar el divisor.

## 7. Embeddings precalculados de la demo

Formato de `seed/fixtures/embeddings.json` (construido en la fase 4; lo lee y lo escribe `seed/knowledge/fixtures.ts`):

```json
{
  "version": 1,
  "model": "openai/text-embedding-3-small",
  "dimensions": 1536,
  "encoding": "f32le-base64",
  "generatedAt": "2026-09-26T10:00:00Z",
  "items": { "<sha256 hex>": "<base64 de 6.144 bytes>" }
}
```

Mientras nadie ha ejecutado `pnpm seed:embeddings`, el archivo del repositorio está vacío: `"generatedAt": null` e
`"items": {}`. El cargador es estricto: un archivo mal formado da un error en español y nunca se usa a medias.

- **Clave** = SHA-256 de `modelo + "\n" + dimensiones + "\n" + texto`, donde el texto es exactamente el que se
  manda a la API (con el prefijo «Documento: …», en NFC y con saltos `\n`). Si cambian el troceado, el texto
  o el modelo, la clave deja de coincidir sola y no se usa un embedding equivocado.
- **Valor** = los 1536 `float32` en little-endian, en base64 (8.192 caracteres): ocupa unas 4 veces menos que un array
  JSON de números sin perder precisión. Al insertarlo en la columna `halfvec` se guarda en media precisión, igual que
  los embeddings que calcula la app.
- Tamaño: unos 8 KB por fragmento; los ~95 textos distintos de los nueve sectores son ~0,8 MB en el repositorio.
- `pnpm seed`: trocea los documentos de la demo con el mismo código que la app, calcula la clave de cada trozo
  (la misma que guarda `kb_chunks.content_hash`) y, si está, inserta el embedding. Si falta, deja el fragmento sin
  embedding (la búsqueda por texto sigue funcionando) y avisa de que hay que ejecutar `pnpm seed:embeddings`. No
  programa ningún trabajo ni llama a la IA: los que falten los calcula el trabajo `knowledge.embeddings` cuando se
  guarda una clave en Ajustes › IA o, si la clave está en `.env.local`, al arrancar la app (`src/instrumentation.ts`,
  [ARR-15]).
- `pnpm seed:embeddings` (necesita `OPENROUTER_API_KEY` en `.env.local`; no abre la base de datos): calcula los
  textos de los nueve sectores, los pide en lotes con `dimensions: 1536` y `data_collection: "deny"`, comprueba que
  cada vector tiene 1536 números finitos, escribe las claves ordenadas para que el `diff` sea legible y elimina
  las que ya no se usan. Si algo falla (sin clave, 401, un tamaño equivocado), no toca el archivo. El propietario
  lo ejecuta una vez con una clave real y guarda el archivo en el repositorio.
- La base de conocimiento de la demo usa el modelo de embeddings por defecto de Ajustes › IA; un vector del
  archivo solo se usa si coinciden la clave, el modelo y las dimensiones.

## 8. Diferencias con el encargo original

- «Comprueba que Turso lo soporta» ya no aplica: la base es Postgres en todas partes (decisión 0024).
- «40 resultados semánticos» filtrados por base exige la búsqueda exacta o la búsqueda iterativa del índice: un
  índice aproximado filtra después de elegir sus candidatos.
- «No uses `unaccent()` en columnas generadas» es correcto; usar la configuración `es_unaccent` dentro de
  `to_tsvector` en la columna generada sí está permitido.
- `websearch_to_tsquery` sirve para un OR si se unen los términos con « or »; tal cual, exige todas las palabras.
- La búsqueda por palabras encuentra ahora las raíces del español, con los dos límites de §3.

## Fuentes

pgvector, PostgreSQL y Supabase (consultadas el 2026-09-26 y el 2026-09-27):

- pgvector (tipos, `halfvec`, HNSW, `ef_search`, búsqueda iterativa, `NULL` y vectores de ceros): https://github.com/pgvector/pgvector/blob/master/README.md
- HNSW en Supabase: https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes
- pgvector en Supabase (esquema `extensions`): https://supabase.com/docs/guides/database/extensions/pgvector
- `unaccent` (ejemplo de configuración): https://www.postgresql.org/docs/current/unaccent.html
- `unaccent()` es `STABLE`: https://github.com/postgres/postgres/blob/master/contrib/unaccent/unaccent--1.1.sql
- Columnas generadas (solo funciones inmutables): https://www.postgresql.org/docs/current/ddl-generated-columns.html
- `to_tsvector` con configuración en columnas generadas: https://www.postgresql.org/docs/current/textsearch-tables.html
- `websearch_to_tsquery` y `ts_rank_cd`: https://www.postgresql.org/docs/current/textsearch-controls.html
- Extensiones en Supabase (esquema `extensions`): https://supabase.com/docs/guides/database/extensions
- Búsqueda híbrida de Supabase (`rrf_k = 50`): https://supabase.com/docs/guides/ai/hybrid-search
- Conexiones y modo transacción (sin sentencias preparadas): https://supabase.com/docs/guides/database/connecting-to-postgres
- PGlite y sus extensiones: https://pglite.dev/docs/about y https://pglite.dev/extensions/

Drizzle:

- Migraciones a medida: https://orm.drizzle.team/docs/kit-custom-migrations (documenta la 1.0)
- Columnas de pgvector e índices: https://orm.drizzle.team/docs/guides/vector-similarity-search
- Columnas generadas: https://orm.drizzle.team/docs/generated-columns
- `customType`: https://orm.drizzle.team/docs/custom-types
- Versiones: https://registry.npmjs.org/drizzle-orm y https://registry.npmjs.org/drizzle-kit

RRF, troceado y tokens:

- Cormack, Clarke y Büttcher, «Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods», SIGIR 2009: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- RRF en Elasticsearch (k = 60 por defecto): https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- Embeddings de OpenAI (1536, 8.192 tokens, `cl100k_base`, normalizados, ~800 tokens por página): https://developers.openai.com/api/docs/guides/embeddings
- Troceado por defecto de OpenAI (800/400): https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/create
