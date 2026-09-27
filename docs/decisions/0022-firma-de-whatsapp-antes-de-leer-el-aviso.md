# 0022 · La firma de los avisos de WhatsApp, antes de leer el aviso

- **Estado:** aceptada (encargo de acabado de las fases 3 y 4, 2026-09-27); sustituye en parte a 0020
- **Fecha:** 2026-09-27

## Contexto y problema

Hasta ahora la app leía el JSON de cada aviso para saber a qué número iba y comprobaba después la firma con el App
Secret de ese canal (0020). Así, lo que llegaba sin firma se interpretaba antes de saber si era de Meta, y cada firma
rechazada escribía un contador en la base de datos: quien no tiene la firma podía hacer trabajar a la app y escribir
en la base con cada petición.

## Opciones consideradas

- **Mantener 0020**: leer primero, con topes de tamaño y de números antes de tocar la base.
- **Comprobar la firma primero con todos los App Secret guardados** (una instalación tiene pocos) y leer el JSON solo
  si alguno la confirma.

## Decisión

La segunda. `processWhatsAppWebhook` (`src/server/channels/whatsapp/webhook.ts`) calcula el HMAC de los bytes tal cual
con cada App Secret distinto guardado (sin los canales de demo) antes de leer el cuerpo:

- Firma incorrecta, ausente o que ningún App Secret guardado puede confirmar, o un cuerpo que no se puede leer: 401 y
  no se guarda nada.
- Con la firma confirmada: los topes de 0020 (más de 1.000 actualizaciones o de 100 números o cuentas → 400) y, como
  antes, cada canal del aviso tiene que ser uno cuyo propio App Secret lo firmó ([WA-32]).
- Firmado por una app de la instalación para un número que no es de ningún canal (o desconectado): 200 y solo la hora
  y el número ([WA-34]).
- Las firmas rechazadas de cada canal (se reconoce buscando su número o su cuenta en los bytes, sin leer el JSON) se
  cuentan en memoria y se escriben en `app_kv` como mucho una vez por minuto y canal; la primera, al momento, para que
  el diagnóstico guiado lo diga enseguida.

## Consecuencias

- Gana: sin la firma nada se interpreta ni se guarda, y una petición sin firma no provoca una escritura en la base por
  cada intento (el límite por IP de la ruta sigue igual).
- Acepta: un aviso para el último número de una app que se desconectó (sus credenciales se borran, [WA-28]) ya no se
  puede comprobar y recibe 401; Meta lo reintenta durante 7 días y lo descarta. Si «Desconectar» también quita la
  suscripción en Meta, esos avisos dejan de llegar.
