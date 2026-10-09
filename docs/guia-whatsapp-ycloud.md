# Guía de WhatsApp con YCloud (coexistencia)

Cómo conectar tu número de WhatsApp a través de YCloud para que tus agentes atiendan a tus clientes **sin que el
número deje de funcionar en la app WhatsApp Business de tu móvil**. Se tarda unos quince minutos.

## Qué es

Hay tres formas de conectar WhatsApp a esta app (Canales › Añadir canal). Esta es la segunda:

- **Es la API oficial de WhatsApp**, pero en vez de conectarte tú directamente con Meta, lo haces a través de
  YCloud, una empresa que es partner oficial de Meta.
- **Coexistencia**: tu número funciona a la vez en la app WhatsApp Business del móvil y aquí. Lo que contestes
  desde el móvil también aparece en la bandeja.
- Es más fácil de preparar que la conexión directa con Meta: no tienes que crear una app de Meta ni un token.

A cambio, necesitas una cuenta en YCloud con saldo.

## Qué necesitas

- Tu número en la app **WhatsApp Business** (la de empresas, no la normal), versión 2.24.17 o posterior.
- Una cuenta en YCloud. La creas tú, con tu correo: https://www.ycloud.com/console/
- Saldo en esa cuenta. Los mensajes que envía la app se pagan a Meta desde ese saldo.
- Para que lleguen los mensajes, la app tiene que estar publicada en una dirección pública con HTTPS. En tu
  ordenador puedes comprobar la clave y dejarlo todo guardado, pero no recibirás nada hasta publicarla.

## Dar de alta el número en YCloud

Esto se hace en la consola de YCloud, no en esta app.

1. Entra en la consola y ve a «WhatsApp accounts».
2. Pulsa «Create Channel» y elige **«WhatsApp Business APP Coexistence»**.
3. Elige «Connect by QR code» (o «Connect with Facebook» si prefieres hacerlo con tu cuenta de Facebook).
4. Escanea el código con la app WhatsApp Business de tu móvil y sigue los pasos. Te preguntará si quieres
   compartir el historial de chats con YCloud: da igual para esta app, que solo lee los mensajes nuevos.
5. Recarga saldo en Settings › Billing › Recharge.

Si YCloud dice que tu número no puede usar la coexistencia, es Meta quien lo decide (depende del país y de cuánto
se ha usado el número). Pregunta al soporte de YCloud.

## Clave

La clave de API es la llave de tu cuenta de YCloud: quien la tenga puede enviar mensajes en tu nombre y gastar tu
saldo.

1. En la consola de YCloud, ve a Developers › API key.
2. La clave está oculta. Para verla, YCloud te pide su verificación en dos pasos.
3. Cópiala entera y pégala en «Clave de API de YCloud». La app la guarda cifrada y nadie vuelve a verla completa.

No la envíes por correo ni la pegues en otro sitio. Si crees que alguien más la tiene, crea otra en YCloud («Add
API Key»), ponla aquí con «Cambiar clave» y borra la antigua en YCloud.

## Conectar

1. En Canales › Añadir canal › WhatsApp, elige «YCloud · coexistencia».
2. Pega la clave y pulsa «Comprobar clave». Verás el saldo y los números de tu cuenta, con su nombre y su estado.
3. Elige el número, ponle un nombre al canal (solo lo ve tu equipo) y elige el agente que contestará.
4. Pulsa «Conectar número». La app crea sola, en YCloud, la dirección por la que le avisan de cada mensaje. No
   tienes que copiar ninguna dirección.

## Modo pruebas

El número empieza en **modo pruebas con la lista vacía: la IA no contesta a nadie**. Es tu número de siempre y no
queremos que el agente empiece a escribir a todos tus clientes sin que lo hayas probado.

- En el panel del canal, pestaña Configuración, añade los contactos con los que quieres probar.
- Cuando estés contento, quita el modo pruebas y la IA contestará a todo el que escriba.

## Lo que escribes desde el móvil

Sigue usando tu móvil como siempre. Cuando contestas a un cliente desde la app WhatsApp Business:

- El mensaje aparece en la bandeja, firmado «Desde el móvil».
- La IA se pausa en esa conversación unas horas (las que tengas configuradas), igual que cuando alguien de tu
  equipo responde desde la bandeja. Así no os pisáis.

**Abre la app del móvil al menos una vez cada 13 días.** Si pasa demasiado tiempo sin usarse, WhatsApp desconecta
el número de la API.

## Las 24 horas y las plantillas

Como con cualquier conexión oficial: puedes escribir libremente a un cliente durante las 24 horas siguientes a su
último mensaje. Pasado ese tiempo solo puedes enviarle una plantilla aprobada por Meta.

- Las plantillas se crean en YCloud (o en WhatsApp Manager).
- En el panel del canal, «Sincronizar plantillas» las trae a la app.

## El panel del número

- **Clave de YCloud**: si YCloud la acepta.
- **Número**: si sigue conectado y con buena calidad.
- **Avisos**: si YCloud puede avisar a la app de los mensajes nuevos.
- **Saldo**: lo que queda en tu cuenta de YCloud.
- **Último mensaje**: cuándo llegó el último.

La app lo revisa sola cada 6 horas y te avisa si algo empeora. «Revalidar» lo revisa en el momento.

## Problemas

- **«YCloud no acepta la clave de API»**: cópiala otra vez en Developers › API key. Si tienes activada la lista de
  IP permitidas en YCloud, añade la de tu servidor.
- **No sale mi número al comprobar la clave**: todavía no está dado de alta en YCloud, o la clave es de otra
  cuenta.
- **«Ya está conectado en otro canal»**: un número solo puede estar una vez en la app, por una sola de las tres
  formas. Desconéctalo o bórralo en el otro canal.
- **Semáforo «Avisos» en ámbar**: la app no tiene dirección pública. Publícala y pulsa «Revalidar».
- **Semáforo «Avisos» en rojo**: alguien borró la dirección en YCloud, o YCloud la desactivó porque fallaba. Pulsa
  «Revalidar» y la app la crea de nuevo.
- **«No queda saldo»**: recarga en Settings › Billing › Recharge.
- **Llegan los mensajes pero la IA no contesta**: mira si sigue en modo pruebas, si el canal tiene agente y si
  hay clave de OpenRouter en Ajustes › IA.
- **Quiero dejar de usarlo aquí**: «Desconectar» en el panel. El número sigue en YCloud y en tu móvil.
