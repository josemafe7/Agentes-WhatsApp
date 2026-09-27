---
name: actualizar
description: "Pasa una instalación de DominIA Agentes a una versión nueva sin perder datos: copia de seguridad de la base de datos antes de nada, comprobación de que las migraciones solo añaden, lint, tipos y pruebas, migraciones en producción, publicación y comprobación de /api/health. Úsala cuando haya que actualizar la app de un negocio, aplicar un parche de seguridad o publicar cambios con la app ya en marcha."
---

# Actualizar

Pasas la instalación de un negocio a una versión nueva siguiendo «9. Publicar una versión nueva» y «10. Copias de seguridad y la clave de cifrado» de `../../../docs/guia-despliegue.md`. Si en `../../../docs/` existe `deployment.md`, manda sobre esta skill. Lo que se revisa con la app publicada está en «Con la app publicada» de `../../../docs/security.md`.

## Reglas

- Habla en español y sin tecnicismos; si usas un término técnico, explícalo en una frase. Pregunta de una en una, con opciones y tu recomendación.
- **Primero, la copia de seguridad.** Sin una copia recién hecha y comprobada, no se aplica ninguna migración ni se publica nada.
- Las migraciones solo pueden añadir (tablas, columnas, índices). Si una borra, renombra o cambia datos, para y explícaselo a la persona.
- Nunca borres, saltes ni cambies una prueba para que pase: arregla el código o pregunta.
- Nunca `pnpm db:fresh`, `pnpm db:reset` ni `pnpm seed` contra la base de un negocio.
- Ningún secreto pasa por el chat ni por tu terminal: la dirección de la base de Supabase (lleva la contraseña) la usa la persona en su terminal, solo para cada orden y nunca guardada en `.env.local`; tú solo llegas a la base con el conector de Supabase (su servidor MCP), limitado al proyecto de esta app y con su permiso. No leas ni muestres archivos `.env*`, salvo `.env.example`.
- Con datos reales, escribir en la base (también aplicar migraciones) solo con el permiso expreso de la persona.
- No hagas commit ni push sin permiso: con la app publicada desde GitHub, subir a `main` la publica.
- Antes de instalar o actualizar un paquete, di qué es y para qué, y espera un sí. Solo con pnpm y respetando el margen de 7 días de `../../../docs/security.md`.

## 1. Qué cambia

1. La versión publicada: `curl -s https://<dominio>/api/health` (campo `"version"`; en PowerShell, `curl.exe`). La nueva: `version` de `../../../package.json`.
2. Resume para la persona, en lenguaje llano, qué trae la versión nueva (con los cambios del historial de Git) y si es un parche de seguridad.
3. Las migraciones nuevas: los archivos de `../../../drizzle/` que no estaban en la versión publicada (compáralo con Git). Léelas: solo `CREATE TABLE` (con su `ENABLE ROW LEVEL SECURITY`), `CREATE INDEX` o `ALTER TABLE … ADD COLUMN`. Nada de `DROP`, de `RENAME` ni de cambios masivos de datos. Cada tabla nueva tiene que activar Row Level Security en la misma migración.

## 2. Pruebas en local

En la versión nueva: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y, si da tiempo, `pnpm test:e2e`; además, `pnpm audit`, sin fallos graves. Todo en verde antes de seguir.

## 3. Copia de seguridad

Con la app en Vercel y Supabase, la persona, en su terminal:

1. Anota la hora, en UTC. Con Supabase Pro hay además una copia de cada día (7 días) y, si tiene PITR (de pago), se puede volver a ese minuto.
2. Hace la copia con la CLI de Supabase (necesita Docker Desktop encendido) y la dirección del «Session pooler» (puerto 5432), como el apartado 10 de la guía: `roles.sql`, `schema.sql` y `data.sql`. Se guardan cifrados, fuera de la carpeta del proyecto y nunca en Git: llevan datos personales.
3. La comprueba: los tres archivos existen, no están vacíos y `data.sql` trae datos de las tablas de la app (por ejemplo, busca `conversations`). Cada pocos meses, además, se restaura en un proyecto de Supabase de pruebas.
4. Confirma que `APP_ENCRYPTION_KEY` sigue en su gestor de contraseñas: sin ella, las claves guardadas en la copia no se pueden leer.

Los archivos de Supabase Storage no entran en esa copia. En local (la demo, con la base integrada): se paran `pnpm dev` y lo demás que la use, se copia entera la carpeta `data/` (la base, `data/pglite`, y los archivos) fuera del proyecto y se vuelve a arrancar.

## 4. Migraciones en producción

Con el permiso de la persona y la copia hecha: ella lanza `pnpm db:migrate` en su terminal con la dirección de la base solo para esa orden, como en el apartado 2 de la guía (nunca guardada en `.env.local`). Tiene que salir «Base de datos al día: la base de datos de Supabase.». O, con su permiso, las aplicas tú con el conector de Supabase, dejándolas anotadas en `drizzle.__drizzle_migrations` como hace `pnpm db:migrate`. Como las migraciones solo añaden, la versión publicada sigue funcionando mientras tanto. Después, el Security Advisor de Supabase (Advisors) no tiene errores nuevos: una tabla sin Row Level Security sale como error.

En local, basta `pnpm db:migrate` (con `pnpm dev` parado: la base integrada solo la abre un proceso).

## 5. Publicar

- **Desde GitHub:** con permiso, commit y push a `main`; Vercel despliega solo. Sigue el despliegue en Deployments o con `pnpm dlx vercel list --prod`.
- **Con la CLI:** `pnpm dlx vercel deploy --prod` desde una copia limpia de la versión nueva.

## 6. Comprobar

1. `curl -s https://<dominio>/api/health`: `"status":"ok"` y la versión nueva.
2. Ajustes › Diagnóstico: «Migraciones» sin pendientes, «Última ronda» reciente y sin trabajos fallidos ni errores de la IA nuevos.
3. Una prueba corta: un mensaje por el chat web o por el simulador, y la respuesta del agente.

## 7. Si algo va mal

- **La versión nueva falla:** con permiso, vuelve a la anterior desde Deployments en Vercel o con `pnpm dlx vercel rollback`. La base ya migrada sirve también para la versión anterior.
- **Los datos se han dañado:** con permiso, restaura. Con Supabase Pro, desde Database › Backups (la copia de un día o, con PITR, un minuto concreto); el proyecto no responde mientras se restaura. Con la copia de la CLI, se restaura con `psql` en un proyecto nuevo de Supabase, en la misma región (https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore); después la persona cambia en Vercel `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY`, vuelve a crear el trabajo de cron y vuelve a desplegar. Los archivos de Storage no están en esa copia: siguen en el proyecto antiguo.
- Si no está claro qué pasa, sigue con la skill `diagnostico`.

## 8. Al terminar

Resume qué versión quedó publicada, qué migraciones se aplicaron, dónde está la copia y qué queda pendiente. Si existe `deployment.md` en `../../../docs/`, propón anotar en él lo que haya cambiado en la forma de publicar.
