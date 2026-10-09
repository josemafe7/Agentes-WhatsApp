# Guía de WhatsApp por código QR

Cómo conectar tu WhatsApp escaneando un código, igual que haces con WhatsApp Web. Es la forma más rápida —un
minuto, sin cuentas ni pagos—, pero **no es la forma oficial**. Lee los riesgos antes de usarla.

## Qué es

Hay tres formas de conectar WhatsApp a esta app (Canales › Añadir canal). Esta es la tercera:

- La app se conecta a tu WhatsApp como un «dispositivo vinculado» más, como WhatsApp Web o WhatsApp para
  ordenador.
- Tu número sigue funcionando en el móvil exactamente igual.
- No necesitas cuenta de Meta ni de YCloud, ni pagar por mensaje.

## Riesgos

Esta forma de conectar usa una librería que no es de WhatsApp (se llama Baileys). Antes de usarla, ten claro que:

- **Va contra las condiciones de WhatsApp.** WhatsApp dice que vincular apps no oficiales puede acabar en un
  bloqueo temporal o permanente de la cuenta. Nadie puede garantizarte que no pase.
- **No la uses con un número del que dependa tu negocio.** Si lo bloquean, pierdes ese WhatsApp. Para un número
  importante usa la API oficial de Meta o YCloud.
- El riesgo sube si el número es nuevo, si escribes a mucha gente que no te ha escrito antes o si envías muchos
  mensajes seguidos. Úsala para contestar a quien te escribe, no para hacer campañas.
- No hay plantillas ni avisos programados por esta vía: los recordatorios de citas por WhatsApp necesitan una
  de las dos formas oficiales.
- Puede dejar de funcionar de un día para otro si WhatsApp cambia algo. Entonces hay que esperar a que la
  librería se actualice.

La app te pide marcar una casilla aceptando este riesgo antes de enseñarte el código.

## Qué necesitas

- La app tiene que estar **siempre encendida**: en tu ordenador (`pnpm dev`) o en un servidor propio. **No
  funciona en Vercel.** Mientras esté apagada, el número no recibe ni contesta aquí (en tu móvil sigue igual), y
  al encenderla recoge lo que llegó entretanto.
- Una sola copia de la app. Si arrancas dos con el mismo número, se quitan la conexión la una a la otra.
- El móvil tiene que conectarse a internet al menos una vez cada 14 días. Si no, WhatsApp cierra los dispositivos
  vinculados.

## Vincular

1. En Canales › Añadir canal › WhatsApp, elige «Código QR · no oficial».
2. Lee el aviso, ponle un nombre al canal, elige el agente y marca la casilla.
3. Pulsa «Generar código QR».
4. En el móvil, abre WhatsApp, ve a Ajustes (en Android, el menú de los tres puntos) › Dispositivos vinculados y
   pulsa «Vincular un dispositivo».
5. Apunta la cámara al código de la pantalla.

El código se renueva solo cada pocos segundos. Si tardas mucho, caduca: pulsa «Generar otro código».

**No compartas el código ni le hagas fotos**: quien lo escanea queda dentro de tu WhatsApp.

## Modo pruebas

Es tu WhatsApp de siempre, con todos tus chats: familia, amigos, proveedores. Por eso el número empieza en **modo
pruebas con la lista vacía: la IA no contesta a nadie**.

- En el panel del canal, pestaña Configuración, añade los contactos con los que quieres probar.
- Quita el modo pruebas solo si quieres que la IA conteste a **todo el que escriba a ese número**. Piénsalo bien
  si es tu número personal.

## Qué lee la app

- Solo los **chats individuales**. Los grupos, los estados, las listas de difusión y los canales no se leen.
- Solo lo que llegue **después de vincular**. Tus conversaciones anteriores no se cargan.
- Texto, notas de voz (las transcribe), fotos y documentos. Lo demás (vídeos, pegatinas, ubicaciones…) aparece
  como «Tipo de mensaje no admitido» y la IA no lo contesta.

## Lo que escribes desde el móvil

Sigue usando tu móvil como siempre. Cuando contestas a alguien desde el móvil:

- El mensaje aparece en la bandeja, firmado «Desde el móvil».
- La IA se pausa en esa conversación unas horas, igual que cuando alguien de tu equipo responde desde la bandeja.

## El panel del número

- **Sesión de WhatsApp**: si la conexión está abierta.
- **App encendida**: si la app puede mantener la conexión.
- **Último mensaje**: cuándo llegó el último.

Botones:

- **Reconectar**: abre de nuevo la conexión si se quedó cerrada.
- **Volver a vincular**: genera un código nuevo cuando la sesión se ha cerrado.
- **Desconectar**: cierra la sesión (desaparece de «Dispositivos vinculados» en tu móvil) y borra lo guardado.

## Problemas

- **El código no aparece o caduca enseguida**: comprueba la conexión a internet del ordenador o servidor donde
  está la app y pulsa «Generar otro código». No lo pidas muchas veces seguidas.
- **«Este número ya no está vinculado»**: cerraste la sesión desde el móvil, o WhatsApp la retiró. Pulsa «Volver a
  vincular» y escanea un código nuevo **con el mismo número**.
- **«Has escaneado con otro número»**: cada canal es de un número. Para otro número, añade otro canal.
- **«Otra copia de la app ha abierto esta misma sesión»**: tienes la app arrancada dos veces. Cierra una y pulsa
  «Reconectar».
- **Llegan los mensajes pero la IA no contesta**: mira si sigue en modo pruebas, si el canal tiene agente y si
  hay clave de OpenRouter en Ajustes › IA.
- **WhatsApp me avisa de un dispositivo vinculado que no reconozco**: es esta app. En el móvil aparece como un
  navegador.
- **Me han bloqueado el número**: la app no puede hacer nada. Tienes que reclamar a WhatsApp desde el móvil.
