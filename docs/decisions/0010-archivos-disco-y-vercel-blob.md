# 0010 · Archivos: disco en local y Vercel Blob privado al publicar

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

La app guarda audios, imágenes y documentos de las conversaciones, los documentos de las bases de
conocimiento, los archivos de contexto de los agentes y el logo del negocio. Casi todo son datos personales o
del negocio. El encargo (§2) pide disco en local, Vercel Blob en Vercel y Supabase Storage en el futuro. Había
que decidir cómo se guardan, cómo se sirven y qué cambia entre un sitio y otro.

Datos comprobados el 26-09-2026 (`docs/plataforma-despliegue.md`, «Vercel Blob» y «Límite de 4,5 MB», salvo
donde se indica otra fuente):

- Las funciones de Vercel tienen el sistema de archivos de solo lectura, con `/tmp` como espacio temporal
  (https://vercel.com/docs/functions/runtimes): allí no se pueden guardar archivos.
- Vercel Blob tiene almacenes privados (con `@vercel/blob` 2.3 o posterior). Privado o público se elige al
  crear el almacén y no se puede cambiar.
- El SDK busca credenciales en este orden: la opción `token`, OIDC con `BLOB_STORE_ID` y
  `BLOB_READ_WRITE_TOKEN`, que además hace falta para las subidas desde el navegador con `handleUpload`. Por eso
  el adaptador se activa con `BLOB_STORE_ID` o `BLOB_READ_WRITE_TOKEN`, no solo con el segundo.
- Una función de Vercel no acepta cuerpos de más de 4,5 MB, y las Server Actions aceptan 1 MB por defecto: las
  subidas grandes van directas del navegador a Blob, con un permiso que genera el servidor tras comprobar la
  sesión y el rol. El aviso de subida terminada de Vercel no llega a localhost ni a las previews protegidas,
  así que el navegador avisa a una ruta propia y el servidor comprueba el archivo antes de registrarlo.
- Vercel recomienda servir los archivos privados comprobando el permiso en la propia ruta, con
  `Cache-Control: private, no-store`, sin cachearlos en su CDN ni fiarse del middleware.
- Hobby incluye 1 GB, 10.000 operaciones simples, 2.000 avanzadas (cada subida cuenta) y 10 GB de transferencia
  al mes; si se superan, Blob queda bloqueado 30 días.
- La URL de un medio de WhatsApp dura 5 minutos y el ID de un medio recibido, 7 días: se descarga en cuanto
  llega (`docs/integracion-whatsapp-mensajes.md`, §10).
- La URL de descarga de un archivo de Telegram lleva el token del bot: nunca se guarda ni se registra
  (`docs/integracion-telegram.md`).

## Opciones consideradas

- **Almacén público con nombres imposibles de adivinar:** cualquiera con la URL ve el archivo; ya no hace falta
  ahora que Blob tiene almacenes privados.
- **Supabase Storage desde ya:** depende de Supabase (0003).
- **Interfaz `FileStorage` con disco en local y en el VPS, y Blob privado en Vercel, servidos siempre por una
  ruta con permisos.**

## Decisión

- Interfaz `FileStorage` con dos implementaciones: `disk` (`data/uploads`, en local y en el volumen del VPS) y
  `vercel-blob` (almacén **privado**), que se activa si existe `BLOB_STORE_ID` o `BLOB_READ_WRITE_TOKEN`.
- Cada archivo se guarda con una clave aleatoria; el nombre original nunca se usa como ruta. Tipo y tamaño se
  comprueban en el servidor.
- Los archivos privados se sirven **siempre** por `/api/files/…`, que comprueba la sesión y el permiso sobre
  ese archivo concreto y lo devuelve en streaming con `X-Content-Type-Options: nosniff` y
  `Cache-Control: private, no-store`. Nunca hay URL públicas de datos privados.
- Los archivos que manda un visitante del chat web entran por la API del widget, con sus propias
  comprobaciones.
- Los medios de los canales se descargan en un trabajo en segundo plano (0008) nada más llegar; los audios
  pasan después a transcripción.
- La limpieza diaria borra los archivos caducados según los plazos de conservación configurados, y borrar un
  documento de conocimiento borra su archivo.
- En el futuro, una implementación con Supabase Storage (buckets privados con políticas) se añade sin tocar a
  quien usa la interfaz.

## Consecuencias

- Gana: ningún archivo privado es público; quien usa la interfaz no sabe dónde se guarda.
- Acepta: la subida grande sigue dos caminos (por la ruta propia en local y en el VPS, directa a Blob en
  Vercel), que hay que probar los dos.
- Acepta: las cuotas de Blob en Hobby son pequeñas; la demo evita subir su contenido a Blob cuando se publique.
- Acepta: en el VPS, las copias de seguridad tienen que incluir el volumen de `data/`, no solo la base de datos.
