# 0020 · Topes de los avisos de WhatsApp antes de comprobar la firma

- **Estado:** sustituida en parte por 0022 (la firma se comprueba antes de leer el aviso; los topes siguen, después)
- **Fecha:** 2026-09-27

## Contexto y problema

La firma de un aviso de WhatsApp se comprueba con el App Secret del canal al que va ([WA-32]), así que antes hay
que leer el cuerpo para saber a qué números y cuentas va. La revisión de seguridad comprobó que un cuerpo sin
firma de casi 3 MB con 46.000 `changes`, cada uno con otro `phone_number_id`, hacía trabajar a la app (lectura del
JSON, consulta con miles de parámetros que libSQL rechaza, un error 500 y un registro por petición) sin tener
ninguna firma válida, a 30 peticiones por segundo por IP con el límite amplio que necesitan las ráfagas de Meta.

## Opciones consideradas

- **Topes antes de tocar la base de datos y un límite bajo para lo rechazado**: más de 1.000 actualizaciones (el
  máximo que Meta pone en un `POST`, `docs/integracion-whatsapp-mensajes.md` §4) o más de 100 números o cuentas
  distintos → 400; y, por IP, 60 peticiones rechazadas (400, 401 o 413) por minuto, aparte del límite amplio de
  1.800.
- **Comprobar la firma con todos los App Secret guardados antes de leer el JSON**: un aviso de un número
  desconectado (sin App Secret) daría 401 y Meta lo reintentaría durante 7 días, en contra de [WA-34].
- **Bajar el límite amplio**: frenaría las ráfagas legítimas de Meta.

## Decisión

La primera. `webhookRouting` (`src/server/channels/whatsapp/normalize.ts`) cuenta las actualizaciones sin
interpretar el cuerpo y descarta lo que supera los topes; la ruta `/api/webhooks/whatsapp` apunta cada respuesta
400, 401 o 413 en un contador por IP y, pasado el límite, responde 429 sin leer nada hasta el minuto siguiente.
Las respuestas 200 no cuentan. `docs/security.md` «Límites y errores» lo recoge.

## Consecuencias

- Gana: sin la firma nadie puede hacer trabajar a la app a voluntad, y un fallo de la base de datos ya no se
  provoca desde fuera.
- Acepta: si Meta mandara más de 1.000 actualizaciones en un aviso, o si una IP de Meta acumulara 60 rechazos en
  un minuto (por ejemplo, con un App Secret equivocado), esos avisos recibirían 400 o 429 y Meta los reintentaría
  más tarde, como hace con cualquier error.
