# 0016 · Código de instalación para crear el primer propietario

- **Estado:** aceptada (con el permiso general del propietario del 2026-09-26)
- **Fecha:** 2026-09-26

## Contexto y problema

El asistente de arranque crea el propietario mientras la instalación no tiene usuarios ([ASI-02]). En local no
hay riesgo, pero una instalación publicada y vacía (recién desplegada, o tras `pnpm db:fresh`) queda abierta a
cualquiera que llegue antes que quien la instala: los dominios nuevos aparecen enseguida en los registros públicos
de certificados y hay quien los recorre. El primero que complete el paso 1 se queda con la instalación. La
revisión de seguridad de la fase 0 lo señaló el 26-09-2026 y pidió llevar la decisión al propietario.

## Opciones consideradas

- **Código de instalación (`SETUP_TOKEN`) obligatorio al publicar:** una variable de entorno secreta que quien
  publica pone en Vercel (o en el VPS) y escribe en el paso 1. En local no se pide.
- **Asistente solo desde el propio ordenador (localhost)** salvo con código: en un servidor publicado no hay
  forma fiable de saber si la petición viene «de dentro», y la cabecera `Host` se puede falsear.
- **Dejarlo como está** y confiar en completar el asistente nada más publicar: deja una ventana abierta cada vez.

## Decisión

Se aplica la recomendación de la revisión: **código de instalación**.

- Si existe `SETUP_TOKEN`, el paso 1 lo pide y lo compara en tiempo constante; si no coincide, no se crea nadie.
- En producción (`NODE_ENV=production`, como en Vercel o con `pnpm start`) sin `SETUP_TOKEN`, nadie puede crear
  el propietario y la pantalla explica cómo configurarlo.
- En local (`pnpm dev`) no se pide, para que el arranque rápido y `pnpm db:fresh` sigan igual.

## Consecuencias

- Gana: una instalación publicada y vacía no la puede tomar quien llegue primero.
- Acepta: un paso más al publicar (crear `SETUP_TOKEN`, explicado en `docs/guia-despliegue.md`) y un campo más en
  el paso 1 de una instalación publicada.
- Si el propietario rechaza la propuesta, se quita la comprobación de `src/data/setup.ts` y se devuelve [ASI-02]
  a su texto anterior.
