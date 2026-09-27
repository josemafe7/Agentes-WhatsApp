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
- Ningún secreto pasa por el chat ni por tu terminal: los tokens de Turso los crea y los usa la persona en su terminal. No leas ni muestres archivos `.env*`, salvo `.env.example`.
- Con datos reales, escribir en la base (también aplicar migraciones) solo con el permiso expreso de la persona.
- No hagas commit ni push sin permiso: con la app publicada desde GitHub, subir a `main` la publica.
- Antes de instalar o actualizar un paquete, di qué es y para qué, y espera un sí. Solo con pnpm y respetando el margen de 7 días de `../../../docs/security.md`.

## 1. Qué cambia

1. La versión publicada: `curl -s https://<dominio>/api/health` (campo `"version"`; en PowerShell, `curl.exe`). La nueva: `version` de `../../../package.json`.
2. Resume para la persona, en lenguaje llano, qué trae la versión nueva (con los cambios del historial de Git) y si es un parche de seguridad.
3. Las migraciones nuevas: los archivos de `../../../drizzle/` que no estaban en la versión publicada (compáralo con Git). Léelas: solo `CREATE TABLE`, `CREATE INDEX` o `ALTER TABLE … ADD COLUMN`. Nada de `DROP`, de `RENAME` ni de cambios masivos de datos.

## 2. Pruebas en local

En la versión nueva: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y, si da tiempo, `pnpm test:e2e`; además, `pnpm audit`, sin fallos graves. Todo en verde antes de seguir.

## 3. Copia de seguridad

Con la app en Vercel y Turso, la persona, en su terminal:

1. Anota la hora, en UTC: la base se podrá llevar a ese momento con la restauración de Turso (24 horas en el plan gratuito, 10 días en Developer).
2. Hace la copia: `turso db export <base> --output-file <base>-<fecha>.db`. Se guarda cifrada, fuera de la carpeta del proyecto y nunca en Git: lleva datos personales.
3. La comprueba: `turso db create prueba-copia --from-file <base>-<fecha>.db`, mira que está y la borra con `turso db destroy prueba-copia`.
4. Confirma que `APP_ENCRYPTION_KEY` sigue en su gestor de contraseñas: sin ella, las claves guardadas en la copia no se pueden leer.

En un servidor propio o en local: se paran la app y el worker, se copia entera la carpeta `data/` (la base y los archivos) fuera del proyecto y se vuelven a arrancar.

## 4. Migraciones en producción

Con el permiso de la persona y la copia hecha: ella crea un token de un día (`turso db tokens create <base> --expiration 1d`) y lanza `pnpm db:migrate` en su terminal con `DATABASE_URL` y `DATABASE_AUTH_TOKEN`, como en el apartado 2 de la guía. Tiene que salir «Base de datos al día: la base de datos remota (Turso)». Como las migraciones solo añaden, la versión publicada sigue funcionando mientras tanto.

En local, basta `pnpm db:migrate`.

## 5. Publicar

- **Desde GitHub:** con permiso, commit y push a `main`; Vercel despliega solo. Sigue el despliegue en Deployments o con `pnpm dlx vercel list --prod`.
- **Con la CLI:** `pnpm dlx vercel deploy --prod` desde una copia limpia de la versión nueva.

## 6. Comprobar

1. `curl -s https://<dominio>/api/health`: `"status":"ok"` y la versión nueva.
2. Ajustes › Diagnóstico: «Migraciones» sin pendientes, «Última ronda» reciente y sin trabajos fallidos ni errores de la IA nuevos.
3. Una prueba corta: un mensaje por el chat web o por el simulador, y la respuesta del agente.

## 7. Si algo va mal

- **La versión nueva falla:** con permiso, vuelve a la anterior desde Deployments en Vercel o con `pnpm dlx vercel rollback`. La base ya migrada sirve también para la versión anterior.
- **Los datos se han dañado:** con permiso, restaura. En Turso, la restauración crea una base nueva (`turso db create <nueva> --from-db <base> --timestamp <hora en UTC>`, o `--from-file` con la copia). La persona crea su token, cambia `DATABASE_URL` y `DATABASE_AUTH_TOKEN` en Vercel y vuelve a desplegar.
- Si no está claro qué pasa, sigue con la skill `diagnostico`.

## 8. Al terminar

Resume qué versión quedó publicada, qué migraciones se aplicaron, dónde está la copia y qué queda pendiente. Si existe `deployment.md` en `../../../docs/`, propón anotar en él lo que haya cambiado en la forma de publicar.
