# Guía de Telegram

Cómo conectar un bot de Telegram para que tus agentes atiendan a los clientes que te escriben por ahí. Se tarda
unos cinco minutos y no hace falta ninguna cuenta de pago: solo Telegram en tu móvil.

## Qué es un bot

Un bot es una cuenta de Telegram que maneja un programa, en este caso esta app. Tus clientes le escriben como a
cualquier contacto y quien contesta es el agente que elijas (o una persona de tu equipo desde la bandeja).

- El bot es tuyo: lo creas tú, con el nombre y el usuario que quieras.
- **Un bot no puede escribir primero.** El cliente tiene que abrir el chat y escribirle; después ya se le puede
  contestar. Por eso la app te da un enlace y un código QR para que los compartas.
- Atiende chats privados. Si alguien mete el bot en un grupo, la app ignora lo que se escribe allí.

## Crear el bot

1. En Canales › Añadir canal › Telegram, escanea con el móvil el código QR de la derecha (o pulsa «Abrir
   @BotFather»). @BotFather es el bot oficial de Telegram para crear bots; lleva una marca azul de verificado.
2. Escríbele `/newbot`.
3. Te pide un **nombre**: es lo que verán tus clientes, por ejemplo «Peluquería Aurora».
4. Te pide un **usuario**: tiene que acabar en `bot` y no estar cogido, por ejemplo `peluqueria_aurora_bot`. No se
   puede cambiar después.
5. @BotFather te contesta con el **token**: una línea con números, dos puntos y letras.

## Token

El token es la llave del bot: quien lo tenga puede leer y escribir en su nombre.

- Cópialo entero y pégalo en «Token del bot». La app lo guarda cifrado y nadie vuelve a verlo completo.
- No lo envíes por correo ni lo pegues en otro sitio.
- Si crees que alguien más lo tiene, pídele a @BotFather uno nuevo (`/mybots`, tu bot, «API Token», «Revoke
  current token») y ponlo en el panel del canal con «Cambiar token».

## Conectar

1. Pega el token, ponle un nombre al canal (solo lo ve tu equipo) y elige el agente que contestará.
2. Pulsa «Conectar bot». La app comprueba el token con Telegram y lo deja todo configurado.
3. Si el bot ya estaba conectado a otra herramienta, la app te avisa de que allí dejará de funcionar y te pide
   confirmación: un bot solo puede estar en un sitio.
4. Aparece el enlace del bot (`https://t.me/tu_bot`) con su código QR. Escanéalo, pulsa «Iniciar» y escribe
   «hola»: el mensaje aparece en pantalla y, si has elegido un agente y la IA está encendida, te contesta.

### Modo local

Si estás probando la app en tu ordenador, Telegram no puede avisarla cuando llega un mensaje, porque tu ordenador
no tiene una dirección pública. La app lo resuelve preguntando ella a Telegram cada pocos segundos: funciona
igual, con una pequeña espera. Cuando publiques la app, entra en el panel del canal y pulsa «Revalidar»: desde ese
momento los mensajes llegan al instante.

## Qué entiende el bot

- **Texto** y **notas de voz**, que se transcriben para que el agente las entienda y tu equipo pueda leerlas.
- **Fotos**, con su texto si lo llevan.
- Los demás tipos (documentos, vídeos, stickers, ubicaciones…) aparecen en la bandeja como «Tipo de mensaje no
  admitido» y el agente no los contesta.
- El agente responde con texto. Desde la bandeja, una persona puede enviar también una imagen.

## Dar el bot a tus clientes

En el panel del canal tienes el «Enlace para tus clientes» y su código QR. Ponlo donde te ven:

- en tu web y en tus redes, como enlace;
- impreso en el mostrador, en la tarjeta o en el escaparate, como código QR.

## El panel del bot

- **Token**: verde si Telegram lo acepta.
- **Recepción**: verde si los mensajes llegan (por avisos o en modo local).
- **Último mensaje**: cuándo llegó el último.
- **Revalidar**: comprueba todo otra vez y vuelve a traer el bot a esta instalación.
- **Cambiar token**: para poner uno nuevo del mismo bot.
- **Desconectar**: Telegram deja de avisar a la app y se borra el token. El canal conserva sus conversaciones.

## Problemas

- **«El token del bot no es válido o se ha revocado».** Cópialo otra vez desde @BotFather (`/mybots`, tu bot,
  «API Token»); a veces se queda un espacio o falta un trozo.
- **Escribo al bot y no llega nada.** Mira el semáforo «Recepción» del panel y pulsa «Revalidar». Si pone que el
  bot envía sus avisos a otra dirección, es que está conectado en otra herramienta.
- **«El bot ya está recibiendo mensajes por otra vía».** Hay otro programa usando el mismo bot. Desconéctalo allí o
  pulsa «Revalidar» para quedártelo aquí.
- **No puedo escribir a un cliente.** O todavía no ha abierto el chat con el bot, o lo ha bloqueado. Tiene que
  escribir él.
- **Las respuestas tardan.** En modo local es normal que tarden unos segundos más. Comprueba también que hay un
  agente activo, que la IA del canal está encendida y que hay clave de OpenRouter en Ajustes › IA.
