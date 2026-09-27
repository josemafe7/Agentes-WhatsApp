# 0018 · El respaldo de la transcripción solo si no guarda datos

- **Estado:** aceptada (con el permiso general del propietario del 2026-09-26; se puede revisar)
- **Fecha:** 2026-09-27

## Contexto y problema

La transcripción de OpenRouter no admite `data_collection` ni `zdr` por petición: su privacidad depende del modelo
([CUM-10]). El de por defecto, `openai/whisper-large-v3-turbo`, solo tiene proveedores sin retención de datos, y
Ajustes › IA avisa si el negocio elige uno que no ([AJU-04]). Pero cuando el modelo de Ajustes fallaba, la app
probaba siempre `mistralai/voxtral-mini-transcribe`, fijo en el código, que el 2026-09-26 solo era sin retención
en su endpoint `mistral/eu` (`docs/integracion-openrouter.md` §10). Con «Sin retención de datos» activado, la nota
de voz del cliente podía acabar en un proveedor que la guarda, sin ningún aviso. La revisión de la fase 2 lo
señaló y pidió que decidiera el propietario.

## Opciones consideradas

- **Usar el respaldo solo si todos sus proveedores están en la lista sin retención**, comprobado igual que el
  aviso de Ajustes (dos peticiones gratuitas, guardadas 12 h por modelo).
- **No usar respaldo cuando «Sin retención de datos» está activado**: el problema sigue sin ZDR, porque la
  transcripción nunca lleva `data_collection: "deny"`.
- **Hacer el respaldo configurable en Ajustes, con el mismo aviso**: otra opción en pantalla para un caso raro.

## Decisión

La primera, la más simple y la que nunca baja la privacidad: el respaldo de la transcripción solo se prueba si
todos sus proveedores están en la lista sin retención de OpenRouter. Si no lo están, o no se puede saber (sin
respuesta de OpenRouter), no se prueba y la nota queda «No se pudo transcribir» ([MED-03]). Hoy, con Whisper en
Ajustes, Voxtral no pasa la comprobación y no se usa; si el negocio elige otro modelo, Whisper sí es su respaldo.
[MED-02] recoge la condición.

## Consecuencias

- Gana: la privacidad de un audio es siempre la del modelo elegido o mejor, y el aviso de Ajustes › IA dice la
  verdad.
- Acepta: hoy no hay un segundo intento con otro proveedor cuando falla Whisper; ese audio lo resuelve una
  persona. Si el propietario prefiere un respaldo configurable, se añade en Ajustes › IA con su aviso.
