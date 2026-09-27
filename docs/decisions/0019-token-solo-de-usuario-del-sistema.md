# 0019 · Solo se conecta WhatsApp con un token de usuario del sistema

- **Estado:** aceptada (sigue [WA-06] de `docs/spec.md` y el encargo; el propietario puede revisarla)
- **Fecha:** 2026-09-27

## Contexto y problema

[WA-06] dice que «Validar con Meta» comprueba que el token es de un usuario del sistema y que, si falta algo,
dice qué y no deja seguir. El encargo pide lo mismo: token válido, de la misma app y de un usuario del sistema;
solo para la caducidad pide avisar. Pero `docs/integracion-whatsapp.md` §3.3 había dejado esa comprobación como
un aviso, porque el campo `type` de `/debug_token` (`SYSTEM_USER`) sale en el ejemplo oficial de los permisos
de WhatsApp y la referencia genérica solo muestra `USER`. El código siguió al documento de integración: un token
personal o el temporal de API Setup se conectaba con un aviso y dejaba de funcionar al caducar. La revisión de la
fase 3 señaló la contradicción.

## Opciones consideradas

- **Bloquear un token cuyo `type` no es `SYSTEM_USER`**, como dice [WA-06]; si Meta no devuelve `type`, no se
  bloquea (no se puede saber).
- **Solo avisar**, como decía el documento de integración, y cambiar [WA-06].

## Decisión

La primera: manda la especificación, que coincide con el encargo. «Validar con Meta» se para con «El token no es de
un usuario del sistema. Genera uno permanente en Usuarios del sistema», marcando el campo del token. Un token de
usuario del sistema que caduca solo avisa, con su fecha ([WA-07]). El semáforo del token del panel sigue avisando
si alguna vez lo detecta después. `docs/integracion-whatsapp.md` §3.3 y la guía de WhatsApp lo recogen.

## Consecuencias

- Gana: no se conecta un número que va a dejar de funcionar en horas o días sin que nadie lo note.
- Acepta: para probar hace falta crear el usuario del sistema y su token (la guía lo explica paso a paso); el token
  temporal de API Setup ya no sirve ni para una prueba rápida. Si Meta cambiara el valor de `type` para los
  usuarios del sistema, la validación lo pararía: el mensaje dice qué pasa y la regla se cambia aquí y en [WA-06].
