-- Custom migration (docs/busqueda-hibrida.md): the extensions the schema needs and the Spanish text search
-- configuration of kb_chunks.search_vector. Extensions live in the `extensions` schema, as Supabase does; Supabase has
-- it on its default search_path and src/db/index.ts sets it for PGlite. Idempotent: they may be enabled already.
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
--> statement-breakpoint
-- es_unaccent = Spanish (stop words and stemming) with accents removed first: «Peluquería» and «peluqueria», «tintes»
-- and «tinte» give the same lexeme. `word` covers words with non-ASCII letters; ASCII words need no unaccent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_ts_config AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.cfgnamespace
    WHERE n.nspname = 'public' AND c.cfgname = 'es_unaccent'
  ) THEN
    CREATE TEXT SEARCH CONFIGURATION public.es_unaccent (COPY = pg_catalog.spanish);
    ALTER TEXT SEARCH CONFIGURATION public.es_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH extensions.unaccent, pg_catalog.spanish_stem;
  END IF;
END
$$;
