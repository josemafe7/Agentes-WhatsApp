# Búsqueda híbrida del conocimiento

Referencia técnica de la búsqueda del conocimiento (§8 de la especificación original) y de su paso futuro a
Supabase (§12): vectores y FTS5 en libSQL, cómo encaja con Drizzle, la fusión RRF, el troceado, los
embeddings precalculados de la demo y lo que cambiará en Postgres. Verificado el **2026-09-26** contra la
documentación oficial de Turso, SQLite, Drizzle, pgvector, PostgreSQL y Supabase, y contra el código fuente
publicado de libSQL, `@libsql/client` y `drizzle-kit`. Lo que no se ha podido comprobar va marcado
**«no verificado»**. Las fuentes están al final.

Por qué este documento: la búsqueda va detrás de dos interfaces (`VectorSearch` y `TextSearch`, en
`src/server/adapters/`) y es el único sitio con SQL propio de libSQL. Aquí está el contrato con el que se
construyen esos adaptadores y sus migraciones a medida, y los límites que hay que respetar para que el mismo
código funcione en local, en Turso y, más adelante, en Postgres.

## Lo esencial

- **Local (`file:…db`) y Turso Cloud con el motor libSQL tienen todo lo necesario**: vectores nativos,
  índice vectorial y FTS5. El binario que instala `@libsql/client` se compila con FTS5 y con el código de
  vectores dentro.
- **Turso Cloud tiene hoy dos motores.** La base de datos se crea con el motor **libSQL**, que es el que sale
  por defecto (`turso db create <nombre>`, sin `--tursodb`). El motor nuevo «Turso» (en vista previa) **no
  tiene FTS5 ni el índice vectorial de libSQL**: solo búsqueda vectorial lineal y un FTS propio con otra
  sintaxis.
- **Con 1536 dimensiones, el índice vectorial con los ajustes por defecto ocupa unos 700 KB por fragmento.**
  Se crea siempre con `compress_neighbors=float8` y `max_neighbors=20` (unos 36 KB por fragmento).
- `vector_top_k` **filtra después**: si se pide 40 y luego se filtra por base de conocimiento, pueden quedar
  menos. Se pide de más (hasta 200) o se hace la búsqueda exacta, que con los tamaños de un negocio pequeño
  es asumible.
- FTS5 con `unicode61 remove_diacritics 2` quita tildes y mayúsculas, pero **no hace raíces en español**
  («tinte» no encuentra «tintes»). La consulta es un OR de términos entre comillas, siempre como parámetro.
- El índice vectorial y la tabla FTS5 apuntan a la fila por su `rowid`. Nuestros ids son UUID en texto, así
  que el `rowid` es implícito y **puede cambiar** con `VACUUM` o si `drizzle-kit` recrea la tabla. Tras
  cualquiera de las dos cosas hay que reconstruir ambos índices.
- Drizzle: la columna vectorial va en el esquema con un `customType`; el índice vectorial, la tabla FTS5 y sus
  disparadores van en una migración a medida (`drizzle-kit generate --custom`). **Nunca `drizzle-kit push`**.
- Fusión RRF con k = 60: cada fragmento suma `1 / (60 + posición)` por cada lista en la que aparece.
- Futuro Postgres: `halfvec(1536)` con HNSW `halfvec_cosine_ops`, `hnsw.iterative_scan` (pgvector 0.8.0 o
  superior) y una configuración de texto `es_unaccent`. En una columna generada vale
  `to_tsvector('es_unaccent', …)`; lo que no vale es la función `unaccent()`.

## 1. Dónde funciona cada pieza

| Entorno | Funciones vectoriales | Índice vectorial (`libsql_vector_idx` + `vector_top_k`) | FTS5 |
|---|---|---|---|
| Local, `@libsql/client` con `file:` | Sí | Sí | Sí |
| Turso Cloud, motor libSQL (por defecto) | Sí | Sí | Sí, precargada en todos los planes |
| Turso Cloud, motor Turso (`--tursodb`) | Sí (`vector32`, `vector_distance_cos`, `vector_extract`…) | **No** (búsqueda lineal; solo hay un índice disperso experimental tras una opción) | **No**: tiene su propio FTS (`CREATE INDEX … USING fts`, `fts_match`, `fts_score`) |

Cómo se ha comprobado:

- **Local.** `@libsql/client` 0.18.0 (última estable, 2026-09-02) depende de `libsql` ^0.5.28 (última
  0.5.29), que usa el crate `libsql` 0.9.30 → `libsql-sys` → `libsql-ffi`. El `build.rs` de `libsql-ffi`
  0.9.30 compila el SQLite de libSQL con `-DSQLITE_ENABLE_FTS5` y no define `SQLITE_OMIT_VECTOR`, que es lo
  único que quitaría los vectores. Además, el ejemplo oficial de Turso para vectores usa
  `createClient({ url: 'file:local.db' })`. Hay binarios ya compilados para Windows x64, macOS y Linux, y
  ninguno de estos paquetes tiene scripts de instalación (pnpm no tiene que aprobar nada). **No se ha
  ejecutado** en esta sesión porque el proyecto aún no tiene dependencias: la primera prueba de la fase 4
  debe crear la tabla, el índice y la tabla FTS5 sobre un archivo local y consultar las dos cosas.
- **Turso Cloud.** La página de extensiones de Turso lista FTS5 como «Built-in» y siempre activa, y la de
  vectores dice que la búsqueda vectorial es nativa de Turso y del servidor libSQL. Esa página no separa por
  motor; que el motor nuevo no tiene FTS5 ni `libsql_vector_idx` sale de su tabla de compatibilidad
  (`COMPAT.md`). **No se ha probado contra una base real** (no se publica nada en esta fase).
- Aviso de estrategia: la documentación de libSQL dice que para proyectos nuevos Turso recomienda su motor
  nuevo, aunque libSQL sigue mantenido y «listo para producción». Elegimos libSQL a propósito por FTS5 y el
  índice vectorial. Si algún día se cambia de motor, hace falta otra implementación de `TextSearch` y
  `VectorSearch` (ver «Plan B»).

### Plan B si un destino no tiene FTS5

No hace falta hoy (local y Turso con libSQL lo tienen), pero la interfaz lo permite sin tocar a quien la
llama:

- **Motor Turso**: su FTS propio (`CREATE INDEX … USING fts (columnas)`, filtro `fts_match(…)`, puntuación
  BM25 con `fts_score(…)`). Sus analizadores (`default`, `simple`, `whitespace`, `ngram`, `raw`) no
  documentan quitar tildes: habría que guardar el texto ya normalizado.
- **Sin ningún FTS**: una columna con el texto en minúsculas y sin tildes (normalizado por la app al
  escribir) y una puntuación por número de términos encontrados con `LIKE '%…%' ESCAPE '\'`. Es un recorrido
  completo de la tabla: vale para cientos o pocos miles de fragmentos.

## 2. Vectores en libSQL

### Tipos

| Tipo | Bytes por vector (D dimensiones) | Con D = 1536 |
|---|---|---|
| `F64_BLOB` / `FLOAT64` | 8D + 1 | 12.289 |
| `F32_BLOB` / `FLOAT32` | 4D | **6.144** |
| `F16_BLOB` / `FLOAT16` | 2D + 1 | 3.073 |
| `FB16_BLOB` / `FLOATB16` | 2D + 1 | 3.073 |
| `F8_BLOB` / `FLOAT8` | D + 14 | 1.550 |
| `F1BIT_BLOB` / `FLOAT1BIT` | ⌈D/8⌉ + 3 | 195 |

- Usamos `F32_BLOB(1536)`, que es lo que Turso recomienda para empezar y la precisión nativa de
  `text-embedding-3-small`. El número entre paréntesis es la dimensión.
- Máximo 65.536 dimensiones. La distancia euclídea no funciona con `FLOAT1BIT`.
- El tipo es solo una pista para SQLite: el vector se guarda como BLOB con sus metadatos dentro.

### Funciones

- `vector32(x)`: convierte a F32. Acepta el texto de un array JSON (`'[0.1, 0.2, …]'`) **o** el binario.
  `vector(x)` es un alias.
- `vector_extract(x)`: devuelve el vector como texto JSON. Es la forma segura de leerlo si alguna vez hace
  falta (ver Drizzle).
- `vector_distance_cos(a, b)`: distancia coseno = 1 − similitud coseno. Va de 0 (iguales) a 2 (opuestos).
  Pueden salir negativos minúsculos (del orden de −10⁻⁹) por redondeo: se tratan como 0. Los dos vectores
  tienen que ser **del mismo tipo y la misma dimensión**.
- Formato binario de F32: 4 bytes por componente, **little-endian**, sin cabecera (comprobado en el código de
  libSQL). Por eso un `Float32Array` de 1536 valores convertido a bytes es un vector válido, y los embeddings
  de la demo se pueden guardar en base64 (ver §7).
- Los embeddings de OpenAI vienen normalizados a longitud 1, así que coseno y producto escalar ordenan igual.

### Índice vectorial

Se crea en la migración a medida, con los ajustes como argumentos de `libsql_vector_idx`:

```sql
CREATE INDEX kb_chunks_embedding_idx
  ON kb_chunks (libsql_vector_idx(embedding, 'metric=cosine', 'compress_neighbors=float8', 'max_neighbors=20'));
```

| Ajuste | Valores | Por defecto | Qué cambia |
|---|---|---|---|
| `metric` | `cosine`, `l2` | `cosine` | Distancia con la que se construye |
| `max_neighbors` | entero > 0 | 3·√D (≈ 117 con 1536) | Vecinos por nodo del grafo: menos = menos espacio y menos precisión |
| `compress_neighbors` | `float1bit`, `float8`, `float16`, `floatb16`, `float32` | sin compresión | Tipo con el que se guardan los vecinos |
| `alpha` | real ≥ 1 | 1,2 | Densidad del grafo: menos = más rápido y menos preciso |
| `search_l` | entero > 0 | 200 | Vecinos visitados al buscar |
| `insert_l` | entero > 0 | 70 | Vecinos visitados al insertar |

Por qué esos ajustes: Turso da la fórmula aproximada del espacio del índice, N · (bytes del vector + M ·
bytes del vecino comprimido). Con 1536 dimensiones:

| Ajustes | Por fragmento | 10.000 fragmentos |
|---|---|---|
| Por defecto (M ≈ 117, sin compresión) | ≈ 6.144 + 117 · 6.144 ≈ 708 KiB | ≈ 7 GB |
| `float8`, M = 20 | ≈ 6.144 + 20 · 1.550 ≈ 36 KiB | ≈ 370 MB |

El plan gratuito de Turso tiene 5 GB en total. Turso publicó un caso real (2024-10-03) con `float8` y
`max_neighbors=20`: índice 8 veces menor sin cambios en los resultados en su prueba de menos de 1.000
nodos, y advierte que con más de 10.000 la diferencia se notaría. `float1bit` es el más pequeño, pero Turso
avisa de que **necesita un modelo de embeddings preparado para 1 bit**: no se usa con `text-embedding-3-small`.
El recall exacto con nuestros datos está **no verificado**: se comprueba con la demo.

Cómo se comporta:

- Se rellena solo al crearlo y se mantiene solo con cada `INSERT`, `UPDATE` y `DELETE`. `REINDEX
  kb_chunks_embedding_idx` lo reconstruye y `DROP INDEX` lo borra.
- Crea tablas internas: `kb_chunks_embedding_idx_shadow` (y su índice) y la global `libsql_vector_meta_shadow`.
- Las filas con `embedding` **NULL no entran** en el índice (comprobado en el código de libSQL, no en la
  documentación). Así un fragmento sin embedding (demo sin clave) no rompe nada.
- Si se inserta un vector de otra dimensión, el índice lo rechaza con «dimensions are different». La columna
  por sí sola no lo impide (**no verificado** que lo haga): la app valida `length === 1536` antes de escribir.
- Solo funciona en tablas **con `rowid`** o con una clave primaria de una sola columna. `kb_chunks` tiene
  `id` UUID en texto sin `WITHOUT ROWID`, así que tiene `rowid` implícito: **no se declara `WITHOUT ROWID`**.
- Admite índices parciales (`… WHERE …`), pero no nos sirven: filtramos por base de conocimiento, que se crea
  desde la interfaz, y haría falta un índice por base.

### Consultar con el índice

El índice solo se usa llamándolo a mano con `vector_top_k(nombre_índice, vector, k)`, que devuelve el
`rowid` de los k vecinos aproximados en una columna llamada `id`. El vector de la consulta tiene que ser del
mismo tipo y dimensión que la columna:

```sql
SELECT c.id, vector_distance_cos(c.embedding, vector32(?)) AS distance
FROM vector_top_k('kb_chunks_embedding_idx', vector32(?), 200) AS v
JOIN kb_chunks AS c ON c.rowid = v.id
WHERE c.kb_id IN (…) AND <fragmento vigente>
ORDER BY distance
LIMIT 40;
```

- Se une por **`c.rowid = v.id`**, no por `c.id`: nuestro `id` es un UUID.
- El orden de `vector_top_k` no está documentado: se ordena siempre por la distancia calculada.
- El `WHERE` se aplica **después** de elegir los k vecinos (filtrado posterior). Si la mayoría son de otras
  bases o de versiones antiguas del índice (`index_version`), quedan menos de 40. Por eso se pide de más.
  Turso dice que el máximo por defecto ronda las 200 filas (encaja con `search_l = 200`; la relación es **no
  verificada**), así que k no pasa de 200.

### Búsqueda exacta (fuerza bruta)

```sql
SELECT c.id, vector_distance_cos(c.embedding, vector32(?)) AS distance
FROM kb_chunks AS c
WHERE c.kb_id IN (…) AND <fragmento vigente> AND c.embedding IS NOT NULL
ORDER BY distance
LIMIT 40;
```

Es exacta y respeta el filtro, pero lee todos los fragmentos elegibles (6 KB cada uno). En Turso se paga por
«filas leídas», y un recorrido completo cuenta una por fila: con 5.000 fragmentos, 100.000 búsquedas al mes
son los 500 millones de lecturas del plan gratuito. Un PDF de 100 páginas son unos 200 fragmentos de 400
tokens (OpenAI calcula unos 800 tokens por página).

### Qué hace el adaptador

1. Si los fragmentos elegibles (bases del agente, versión vigente, con embedding) son pocos, búsqueda exacta.
   Umbral orientativo: 5.000, en una constante con nombre (**no medido**).
2. Si son más, `vector_top_k` con k = 200 y filtro posterior.
3. Si tras filtrar quedan menos de 40 y hay más elegibles, se completa con la búsqueda exacta.
4. Nunca se devuelven los embeddings: solo `id` y distancia.

## 3. FTS5 en libSQL

### La tabla

Tabla FTS5 de **contenido externo**: guarda solo el índice de palabras y lee el texto de `kb_chunks` cuando
hace falta. Los nombres de las columnas tienen que coincidir con columnas de `kb_chunks` (aquí `title`,
`section` y `content` son de ejemplo):

```sql
CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
  title, section, content,
  content = 'kb_chunks', content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
```

- `unicode61`: separa por espacios y puntuación (Unicode 6.1) y no distingue mayúsculas.
- `remove_diacritics 2`: quita los diacríticos de **todas** las letras latinas; con `1` (el valor por
  defecto) quedan casos raros sin quitar. Existe desde SQLite 3.27.0; libSQL va muy por delante.
- Con esto, «médico», «MEDICO» y «medico» son el mismo término, y la consulta pasa por el mismo analizador.
- FTS5 **no hace raíces en español**: el analizador `porter` es para inglés. «tinte» no encuentra «tintes».
  Mejora opcional: en términos largos, buscar también por prefijo (`"tinte"*`); un prefijo exige recorrer
  un rango de términos y es algo más lento.

Por qué contenido externo y no las otras dos opciones:

- **Normal** (guarda su copia del texto): duplica todo el texto de la base. Su ventaja, que no depende del
  `rowid` de otra tabla, no nos basta porque el índice vectorial depende de él igualmente.
- **Sin contenido** (`content=''`): no puede devolver columnas ni admite `UPDATE` o `DELETE` normales.
- **Contenido externo**: no duplica texto; a cambio, mantenerlo al día es cosa nuestra, con disparadores.

### Disparadores

Los tres del ejemplo oficial de SQLite, adaptados. El de borrado usa el comando especial `'delete'` con los
valores **antiguos**, porque FTS5 necesita el texto que indexó para quitarlo:

```sql
CREATE TRIGGER kb_chunks_fts_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(rowid, title, section, content) VALUES (new.rowid, new.title, new.section, new.content);
END;
CREATE TRIGGER kb_chunks_fts_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, section, content) VALUES ('delete', old.rowid, old.title, old.section, old.content);
END;
CREATE TRIGGER kb_chunks_fts_au AFTER UPDATE OF title, section, content ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, section, content) VALUES ('delete', old.rowid, old.title, old.section, old.content);
  INSERT INTO kb_chunks_fts(rowid, title, section, content) VALUES (new.rowid, new.title, new.section, new.content);
END;
```

- `AFTER UPDATE OF …` evita reindexar el texto cuando solo cambia el embedding u otra columna.
- Crear los disparadores **no** indexa las filas que ya existían: tras crearlos (y tras cualquier arreglo) se
  ejecuta `INSERT INTO kb_chunks_fts(kb_chunks_fts) VALUES('rebuild');`, que reconstruye el índice desde
  `kb_chunks`.
- **Nunca `INSERT OR REPLACE` en `kb_chunks`**: cuando `REPLACE` borra una fila para resolver un conflicto,
  los disparadores de borrado solo se ejecutan si están activados los disparadores recursivos, y el índice
  quedaría con restos. Los fragmentos no se modifican: se insertan los de la versión nueva y se borran los
  viejos. Un `ON CONFLICT DO UPDATE` sí dispara el de actualización.

### Consulta

```sql
SELECT c.id, bm25(kb_chunks_fts) AS score
FROM kb_chunks_fts
JOIN kb_chunks AS c ON c.rowid = kb_chunks_fts.rowid
WHERE kb_chunks_fts MATCH ? AND c.kb_id IN (…) AND <fragmento vigente>
ORDER BY score
LIMIT 40;
```

- `bm25()` devuelve **números más bajos cuanto mejor** es el resultado (FTS5 lo multiplica por −1), así que
  se ordena ascendente. Admite pesos por columna en el orden de la tabla, p. ej. `bm25(kb_chunks_fts, 2.0,
  1.5, 1.0)` para dar más peso al título (opcional, sin calibrar).
- Aquí el filtro es **exacto**: SQLite aplica el `WHERE` antes del `LIMIT`, no hay un k previo que recortar.
- Para RRF solo importa la posición, no el valor de `bm25`.

### Construir la expresión `MATCH` desde lo que escribe el cliente

La sintaxis de FTS5 tiene operadores (`AND`, `OR`, `NOT`, `NEAR`, `*`, `^`, `:`, paréntesis) y varias
palabras seguidas se unen con un **AND implícito**. Para que sea un OR de palabras clave y no falle con
cualquier texto:

1. Normalizar (NFKC y minúsculas) y extraer palabras con una expresión Unicode de letras y números.
2. Quitar palabras vacías del español (una lista en el código: «de», «la», «que», «el», «en», «y»…). FTS5 no
   tiene lista de palabras vacías, y en un OR «de» coincide con casi todo y llena los 40 resultados de ruido.
3. Quitar las de menos de 2 caracteres, quitar repetidas y quedarse con un máximo razonable (unas 12).
4. Poner cada término **entre comillas dobles**, duplicando cualquier comilla doble interna (así lo escapa
   FTS5), y unirlos con `" OR "`: `"precio" OR "tinte" OR "mechas"`. Entre comillas, `OR`, `NOT` o `*` son
   texto, no operadores.
5. Pasar la expresión **siempre como parámetro** (`MATCH ?`), nunca pegada al SQL.
6. Si no queda ningún término, no se consulta FTS5 (lista vacía).

## 4. Drizzle con libSQL

Versiones estables el 2026-09-26: `drizzle-orm` 0.45.3 y `drizzle-kit` 0.31.11 (2026-09-21). Existe una
1.0.0 en «release candidate» y **la web de Drizzle ya documenta la 1.0** (por ejemplo, migraciones en una
carpeta por migración); con la 0.31 son archivos `drizzle/NNNN_nombre.sql` y `drizzle/meta/_journal.json`.
No se usan versiones candidatas (`docs/security.md`).

### Columna vectorial en el esquema

Con `customType` de `drizzle-orm/sqlite-core`:

- `dataType` devuelve `F32_BLOB(1536)` (con la dimensión como configuración obligatoria). Así
  `drizzle-kit generate` crea la columna en la migración normal.
- `toDriver` devuelve un fragmento SQL `vector32(<json>)`: en 0.45.3 el tipo de `toDriver` admite devolver
  `SQL` además del valor. Alternativa: pasar los bytes (`Uint8Array` del `Float32Array`) dentro de
  `vector32(?)`, que evita convertir 1536 números a texto.
- **Leer**: no se lee nunca el embedding (la búsqueda solo devuelve ids y distancias). Si hiciera falta,
  `vector_extract(embedding)` y `JSON.parse`. Motivo: `@libsql/client` devuelve los BLOB como
  `ArrayBuffer`, y en modo local lo saca con `buffer.buffer` del `Buffer` nativo, que podría incluir bytes
  de fuera del valor (**no verificado** que pase con estos búferes).
- **Ninguna consulta hace `select()` de la fila entera de `kb_chunks`**: arrastraría 6 KB por fragmento. Se
  eligen las columnas.

Dos avisos sobre la guía de Drizzle de Turso: crea el índice con `USING vector_cosine(3)`, sintaxis que no
aparece en la documentación de libSQL (se usa `libsql_vector_idx`), y su `fromDriver` usa `value.buffer`
suponiendo un `Buffer`, cuando el cliente devuelve un `ArrayBuffer`.

### Migración a medida

El índice vectorial, la tabla FTS5, sus disparadores y el `rebuild` no los genera Drizzle. Van en una
migración a medida, que crea solo el integrador de la fase:

- `pnpm drizzle-kit generate --custom --name=kb-search-indexes` crea un `.sql` vacío numerado y lo apunta en
  el diario (en la 0.31.11 la opción se describe como «Prepare empty migration file for custom SQL»).
- **Cada sentencia separada por `--> statement-breakpoint`**: el migrador de Drizzle parte el archivo por esa
  marca y ejecuta cada trozo como una sola sentencia. Un disparador, con sus `;` internos, es un solo trozo.
- Orden: índice vectorial, tabla FTS5, tres disparadores y `rebuild`.
- La migración normal que crea `kb_chunks` tiene que ir antes.

### Lo que `drizzle-kit` ve y lo que no

- `generate` compara el esquema TypeScript con la última instantánea en `drizzle/meta/`: **no lee la base de
  datos**, así que no ve ni intenta borrar la tabla FTS5 ni las tablas internas del índice.
- `push`, `pull` y Studio sí leen `sqlite_master`. Solo ignoran `__drizzle_migrations` y los nombres que
  empiezan por `_cf_`, `_litestream_`, `libsql_` y `sqlite_`. Verían `kb_chunks_fts`, sus tablas internas
  (`kb_chunks_fts_data`, `_idx`, `_docsize`, `_config`) y `kb_chunks_embedding_idx_shadow`, y `push`
  intentaría borrarlas. Por eso **nunca se usa `push`**. Si se usa `pull` o Studio, `tablesFilter` admite
  exclusiones con `!` (p. ej. `['*', '!kb_chunks_fts*', '!*_shadow*']`).
- **Recrear la tabla.** Cuando un cambio no se puede hacer con `ALTER TABLE` en SQLite, `drizzle-kit` genera:
  crear `__new_kb_chunks`, copiar con `INSERT … SELECT` (sin copiar el `rowid`), `DROP TABLE` y renombrar.
  Eso **borra el índice vectorial y los disparadores**, y los `rowid` pueden cambiar. Con `dialect: 'turso'`
  algunos cambios de columna usan el `ALTER COLUMN` de libSQL, pero la recreación sigue existiendo para
  otros. Regla: si una migración generada recrea `kb_chunks`, justo detrás va una a medida que vuelve a crear
  el índice y los disparadores y ejecuta el `rebuild`.

### El `rowid` y `VACUUM`

Según SQLite, `VACUUM` puede cambiar el `rowid` de las tablas sin `INTEGER PRIMARY KEY`, y `kb_chunks` es
una de ellas (su clave es un UUID en texto, por portabilidad). El índice vectorial y la tabla FTS5 guardan
ese `rowid`: si cambia, devuelven fragmentos equivocados sin dar error. Por eso:

- No se ejecuta `VACUUM` sin reconstruir después.
- Reconstruir = `REINDEX kb_chunks_embedding_idx;` y `INSERT INTO kb_chunks_fts(kb_chunks_fts)
  VALUES('rebuild');`. Lo ofrece el adaptador como mantenimiento («Reconstruir índices de búsqueda» en
  Diagnóstico) y lo ejecuta el reindexado completo de una base.

### SQL solo en los adaptadores

Todo lo anterior vive en `src/server/adapters/**` y en `drizzle/`. Se escribe con la plantilla `sql` de
Drizzle, que convierte cada valor en parámetro; nunca `sql.raw` con nada que venga del usuario. El vector de
la consulta y la expresión `MATCH` son siempre parámetros.

## 5. Fusión RRF y resultado

1. Normalizar la consulta y construir la expresión FTS5 (§3).
2. Con clave de OpenRouter: embedding de la consulta (1536, validado) y **40 resultados vectoriales**. Sin
   clave, esta lista queda vacía y la búsqueda es solo de texto (requisito de la demo).
3. **40 resultados de texto** con FTS5.
4. **RRF con k = 60** (Cormack, Clarke y Büttcher, SIGIR 2009): cada fragmento suma `1 / (60 + posición)` por
   cada lista en la que aparece, con la posición empezando en 1. Ejemplo: 1.º en vectores y 3.º en texto =
   1/61 + 1/63 ≈ 0,0323; solo 1.º en una lista = 1/61 ≈ 0,0164. No hay que normalizar las puntuaciones de
   cada lista, porque solo cuenta la posición. Empates: primero el de mejor posición vectorial, después por
   id, para que el orden sea estable en las pruebas.
5. Los **8 mejores**; con rerank activado (interruptor de toda la instalación en Ajustes > IA, [AJU-04];
   `POST /api/v1/rerank`, ver `docs/integracion-openrouter.md`) se reordenan y se quedan **6**. Si el rerank
   falla, se devuelven los 8 de RRF sin reordenar.
6. **`SIN_RESULTADOS`** si nada es relevante. La puntuación RRF no sirve para decidirlo (es relativa): se usa
   la similitud del mejor resultado vectorial (1 − distancia), si hubo coincidencias de texto y, con rerank,
   su `relevance_score`. Los umbrales son **no verificados** y se calibran con la demo; van en constantes con
   nombre.
7. Respuesta de unos 3.500 tokens como máximo, en fragmentos numerados con título, sección y página, y lo
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

Propuesta de formato para `seed/fixtures/embeddings.json`:

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

- **Clave** = SHA-256 de `modelo + "\n" + dimensiones + "\n" + texto`, donde el texto es exactamente el que se
  manda a la API (con el prefijo «Documento: …», en NFC y con saltos `\n`). Si cambian el troceado, el texto
  o el modelo, la clave deja de coincidir sola y no se usa un embedding equivocado.
- **Valor** = los 1536 `float32` en little-endian, en base64 (8.192 caracteres). Es el formato binario de
  `F32_BLOB`, se inserta tal cual con `vector32(?)` pasando los bytes, y ocupa unas 4 veces menos que un array
  JSON de números sin perder precisión.
- Tamaño: unos 8 KB por fragmento; 150 fragmentos de demo son ~1,2 MB en el repositorio.
- `pnpm seed`: trocea los documentos de la demo, calcula la clave de cada trozo y, si está, inserta el
  embedding. Si falta, deja el fragmento sin embedding (la búsqueda por texto sigue funcionando) y avisa de
  que hay que ejecutar `pnpm seed:embeddings`.
- `pnpm seed:embeddings` (necesita clave): recalcula todo, escribe las claves ordenadas para que el `diff` sea
  legible y elimina las que ya no se usan.
- La base de conocimiento de la demo guarda el mismo modelo y dimensiones que el archivo; si no coinciden,
  el seed no usa el archivo.

## 8. Futuro: Supabase (Postgres)

La restricción que impide citas solapadas en Postgres no es de la búsqueda: está en `docs/modelo-de-datos.md`
(«Sin dobles reservas»).

### Vectores con pgvector

- Columna `halfvec(1536)`: media precisión, `2 · 1536 + 8` = 3.080 bytes por vector (la mitad que `vector`).
  HNSW indexa `halfvec` hasta 4.000 dimensiones (`vector`, hasta 2.000). Drizzle tiene `halfvec` en
  `pg-core` y el método de índice `hnsw`.
- Índice y operador coseno:

```sql
CREATE INDEX ON kb_chunks USING hnsw (embedding halfvec_cosine_ops);
-- consulta: ORDER BY embedding <=> $1::halfvec(1536) LIMIT 40
```

- `hnsw.ef_search` (40 por defecto) limita cuántos resultados puede devolver la búsqueda aproximada: con
  `LIMIT 40` y filtros se sube (p. ej. 100) con `SET LOCAL` dentro de la transacción.
- **`hnsw.iterative_scan`** (desde pgvector **0.8.0**): con filtros, sigue recorriendo el índice hasta tener
  suficientes filas o llegar a `hnsw.max_scan_tuples` (20.000 por defecto). Valores: `off` (por defecto),
  `strict_order` (orden exacto por distancia) y `relaxed_order` (mejor recall, orden aproximado; se reordena
  con un CTE `MATERIALIZED`). La versión se comprueba con `SELECT extversion FROM pg_extension WHERE extname
  = 'vector';`.
- Con el pooler en modo transacción, los `SET` de sesión no son fiables: siempre `SET LOCAL` dentro de una
  transacción.

### Texto: configuración `es_unaccent`

En Supabase las extensiones van en el esquema `extensions`:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE TEXT SEARCH CONFIGURATION public.es_unaccent ( COPY = pg_catalog.spanish );
ALTER TEXT SEARCH CONFIGURATION public.es_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH extensions.unaccent, pg_catalog.spanish_stem;
```

- Es el ejemplo oficial de `unaccent` (hecho con `french`) cambiado a `spanish`: primero quita tildes y
  después saca la raíz. A diferencia de FTS5, aquí sí hay raíces («tintes» encuentra «tinte»).
- Solo se cambian `hword`, `hword_part` y `word`, los tipos de palabra con letras no ASCII, como en el ejemplo.
- Columna generada: `tsvector GENERATED ALWAYS AS (to_tsvector('public.es_unaccent', coalesce(title, '') ||
  ' ' || content)) STORED`, con índice GIN.
- **Por qué no `unaccent()` en la columna generada**: una expresión generada solo puede usar funciones
  `IMMUTABLE`, y `unaccent()` está declarada `STABLE` (depende del diccionario). `to_tsvector` con la
  configuración escrita sí vale: es lo que usa la documentación de PostgreSQL en su ejemplo de columna
  generada. Contrapartida: si algún día se cambia `es_unaccent`, los `tsvector` guardados no se recalculan
  solos; hay que forzarlo.
- La configuración se crea en una migración anterior a la tabla.

### Consulta OR en Postgres

- `websearch_to_tsquery` une las palabras sueltas con `&` (exige todas): no se usa tal cual.
- Opción A: un `plainto_tsquery('public.es_unaccent', $n)` por término, unidos con el operador `||` de
  `tsquery` (OR). Cada término es un parámetro.
- Opción B: los términos ya limpios (§3, sin guiones, porque en `websearch_to_tsquery` un guion es NOT) unidos
  con `" or "` y pasados a `websearch_to_tsquery`, que entiende `or` como OR y **nunca da error de sintaxis**.
- Orden con `ts_rank_cd`; para RRF solo cuenta la posición.

### Plataforma

- **Plan gratuito**: los proyectos con poca actividad durante 7 días se pausan; se pueden restaurar durante
  1 año. Los de pago no se pausan. En producción, Pro.
- **Conexión**: la directa (`db.<ref>.supabase.co:5432`) es IPv6, o IPv4 con el complemento de pago. Desde un
  VPS o Docker solo IPv4, el **pooler compartido (Supavisor) en modo sesión**, puerto 5432, usuario
  `postgres.<ref>` y host `aws-<n>-<región>.pooler.supabase.com` (el número no se deduce de la región: se
  copia del panel). Para funciones sin servidor, modo transacción (puerto 6543), que **no admite sentencias
  preparadas** y hay que desactivarlas en el cliente. El pooler dedicado de pago es solo IPv6 sin el
  complemento.

## 9. Diferencias con el encargo original

- «Comprueba que Turso lo soporta»: sí, **con el motor libSQL** (el de por defecto). El motor nuevo de Turso,
  que Turso recomienda para proyectos nuevos, no tiene FTS5 ni el índice vectorial de libSQL.
- El índice vectorial con los ajustes por defecto no es viable con 1536 dimensiones (~708 KiB por fragmento):
  hay que fijar `compress_neighbors` y `max_neighbors`.
- `vector_top_k` filtra después: «40 resultados semánticos» filtrados por base exige pedir de más o búsqueda
  exacta.
- FTS5 no hace raíces en español; Postgres con `es_unaccent` sí. Los resultados de texto no serán iguales en
  los dos motores.
- «No uses `unaccent()` en columnas generadas» es correcto; usar la configuración `es_unaccent` dentro de
  `to_tsvector` en la columna generada sí está permitido.
- `websearch_to_tsquery` sirve para un OR si se unen los términos con « or »; tal cual, exige todas las
  palabras.
- Con ids UUID en texto, el `rowid` de `kb_chunks` puede cambiar con `VACUUM` o si Drizzle recrea la tabla;
  hay que reconstruir los índices.

## Fuentes

Consultadas el 2026-09-26.

Turso y libSQL:

- Vectores en libSQL (tipos, funciones, índice, ajustes, `vector_top_k`, límites): https://docs.turso.tech/features/ai-and-embeddings
- Extensiones precargadas en Turso Cloud (FTS5 «Built-in»): https://docs.turso.tech/features/sqlite-extensions
- Dos motores en Turso Cloud: https://docs.turso.tech/turso-cloud y https://docs.turso.tech/quickstart (`--tursodb`)
- Estado de libSQL: https://docs.turso.tech/libsql
- FTS del motor Turso: https://docs.turso.tech/sql-reference/functions/fts y https://docs.turso.tech/sql-reference/functions/vector
- Compatibilidad del motor Turso: https://github.com/tursodatabase/turso/blob/main/COMPAT.md
- Espacio del índice y `float8` + `max_neighbors=20` (2024-10-03): https://turso.tech/blog/the-space-complexity-of-vector-indexes-in-libsql
- Filtrado posterior y máximo de ~200 (2024-11-11): https://turso.tech/blog/filtering-in-vector-search-with-metadata-and-rag-pipelines
- Ejemplo local con `file:`: https://turso.tech/vector
- Guía Drizzle de Turso: https://docs.turso.tech/sdk/ts/orm/drizzle
- Facturación por filas leídas: https://docs.turso.tech/help/usage-and-billing y plan gratuito: https://turso.tech/pricing
- Código de libSQL (formato F32, NULL, dimensiones, tablas internas): https://github.com/tursodatabase/libsql/tree/main/libsql-sqlite3/src (`vector.c`, `vectorfloat32.c`, `vectorIndex.c`, `vectordiskann.c`)
- Opciones de compilación: https://docs.rs/crate/libsql-ffi/0.9.30/source/build.rs y https://github.com/tursodatabase/libsql-js (v0.5.29)
- `@libsql/client` 0.18.0 (tipos `Value` e implementación local): https://unpkg.com/@libsql/core@0.18.0/lib-esm/api.d.ts y https://unpkg.com/@libsql/client@0.18.0/lib-esm/sqlite3.js
- Versiones: https://registry.npmjs.org/@libsql/client y https://registry.npmjs.org/libsql

SQLite:

- FTS5 (cadenas, operadores, `unicode61`, contenido externo, disparadores, `rebuild`, `bm25`, prefijos, `porter`): https://www.sqlite.org/fts5.html
- `remove_diacritics=2` desde 3.27.0: https://www.sqlite.org/changes.html
- `VACUUM` y `rowid`: https://www.sqlite.org/lang_vacuum.html
- `REPLACE` y disparadores de borrado: https://www.sqlite.org/lang_conflict.html

Drizzle:

- Migraciones a medida: https://orm.drizzle.team/docs/kit-custom-migrations (documenta la 1.0)
- `customType`: https://orm.drizzle.team/docs/custom-types
- Código de `drizzle-kit` 0.31.11 (opción `--custom`, tablas ignoradas, `tablesFilter`, recreación de tablas): https://unpkg.com/drizzle-kit@0.31.11/bin.cjs
- Migrador de `drizzle-orm` 0.45.3 (`--> statement-breakpoint`): https://unpkg.com/drizzle-orm@0.45.3/migrator.js y https://unpkg.com/drizzle-orm@0.45.3/libsql/migrator.js
- Tipo de `toDriver`: https://unpkg.com/drizzle-orm@0.45.3/sqlite-core/columns/custom.d.ts
- Versiones: https://registry.npmjs.org/drizzle-orm y https://registry.npmjs.org/drizzle-kit

RRF, troceado y tokens:

- Cormack, Clarke y Büttcher, «Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods», SIGIR 2009: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- RRF en Elasticsearch (k = 60 por defecto): https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- Embeddings de OpenAI (1536, 8.192 tokens, `cl100k_base`, normalizados, ~800 tokens por página): https://developers.openai.com/api/docs/guides/embeddings
- Troceado por defecto de OpenAI (800/400): https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/create

pgvector, PostgreSQL y Supabase:

- pgvector (tipos, HNSW, `ef_search`, iteraciones, límites): https://github.com/pgvector/pgvector/blob/master/README.md
- HNSW en Supabase: https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes
- `unaccent` (ejemplo de configuración): https://www.postgresql.org/docs/current/unaccent.html
- `unaccent()` es `STABLE`: https://github.com/postgres/postgres/blob/master/contrib/unaccent/unaccent--1.1.sql
- Columnas generadas (solo funciones inmutables): https://www.postgresql.org/docs/current/ddl-generated-columns.html
- `to_tsvector` con configuración en columnas generadas: https://www.postgresql.org/docs/current/textsearch-tables.html
- `websearch_to_tsquery` y `tsquery || tsquery`: https://www.postgresql.org/docs/current/textsearch-controls.html y https://www.postgresql.org/docs/current/functions-textsearch.html
- Extensiones en Supabase (esquema `extensions`): https://supabase.com/docs/guides/database/extensions
- Búsqueda híbrida de Supabase (`rrf_k = 50`): https://supabase.com/docs/guides/ai/hybrid-search
- Pausa del plan gratuito: https://supabase.com/docs/guides/platform/free-project-pausing
- Conexiones, IPv4 y pooler: https://supabase.com/docs/guides/database/connecting-to-postgres
