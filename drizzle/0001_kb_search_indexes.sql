-- Custom migration (docs/busqueda-hibrida.md §2–§4): vector index and FTS5 over kb_chunks.
-- Both point to kb_chunks.rowid. After VACUUM or a migration that recreates kb_chunks, rebuild them:
--   REINDEX kb_chunks_embedding_idx;  INSERT INTO kb_chunks_fts(kb_chunks_fts) VALUES('rebuild');
-- Order: vector index, FTS5 table, three triggers, rebuild. One statement per breakpoint.
CREATE INDEX `kb_chunks_embedding_idx` ON `kb_chunks` (libsql_vector_idx(`embedding`, 'metric=cosine', 'compress_neighbors=float8', 'max_neighbors=20'));
--> statement-breakpoint
CREATE VIRTUAL TABLE `kb_chunks_fts` USING fts5(
  title, section, content,
  content = 'kb_chunks', content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `kb_chunks_fts_ai` AFTER INSERT ON `kb_chunks` BEGIN
  INSERT INTO kb_chunks_fts(rowid, title, section, content) VALUES (new.rowid, new.title, new.section, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `kb_chunks_fts_ad` AFTER DELETE ON `kb_chunks` BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, section, content) VALUES ('delete', old.rowid, old.title, old.section, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `kb_chunks_fts_au` AFTER UPDATE OF title, section, content ON `kb_chunks` BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, section, content) VALUES ('delete', old.rowid, old.title, old.section, old.content);
  INSERT INTO kb_chunks_fts(rowid, title, section, content) VALUES (new.rowid, new.title, new.section, new.content);
END;
--> statement-breakpoint
INSERT INTO kb_chunks_fts(kb_chunks_fts) VALUES('rebuild');
