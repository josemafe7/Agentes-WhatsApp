# Guía de Instagram

Cómo conectar la cuenta de Instagram del negocio para que tus agentes respondan a los **mensajes directos** (DM) y tu
equipo pueda contestar también desde la bandeja. Se hace una vez por cuenta, en unos quince minutos. En la app, el
asistente está en **Canales › Añadir canal › Instagram**, y cada campo tiene un «¿Dónde lo encuentro?» que abre aquí el
apartado que le toca.

La conexión usa la API oficial de Instagram con una **app de Meta del propio negocio**, sin página de Facebook. Los
menús de Meta cambian de vez en cuando de nombre o de sitio, y algunas pantallas solo están en inglés: aquí van con
su nombre en inglés, tal como los muestra Meta.

## Qué necesitas

- Una **cuenta profesional de Instagram** (de empresa o de creador) y **pública**. Si es personal, cámbiala en la app
  de Instagram antes de empezar.
- Una cuenta de desarrollador de Meta para crear la **app de Meta de tipo «Business»** con el producto Instagram
  (apartado «Crear la app de Meta»).
- **Publicar la app de Meta** (apartado «Publicar la app»): Meta solo envía los mensajes a una app publicada.
- **DominIA Agentes publicada en internet con HTTPS** (guía «Publicar la app en Vercel», en Ayuda). En local puedes
  conectar la cuenta y comprobar el token, pero no llegan mensajes: el asistente lo avisa.
- Entrar en DominIA Agentes como **propietario o administrador**.
- **Otra cuenta de Instagram** para la prueba final, que no sea la del negocio ni tenga ningún papel en la app de Meta
  (apartado «Prueba»).

Qué hace la app con la cuenta:

- Responde con **texto** a los mensajes directos, con el agente que elijas, y deja contestar a tu equipo desde la
  bandeja. En la bandeja, cada conversación dice siempre de qué canal es: «Instagram · nombre del canal».
- Entiende **texto**, **notas de voz** (las transcribe), **imágenes** y **PDF** (apartado «Solo texto»).
- Solo puede responder **en las 24 horas siguientes** al último mensaje del cliente (apartado «La ventana de 24
  horas»).

## Crear la app de Meta

La app de Meta es la pieza con la que DominIA Agentes habla con Instagram. Es del negocio y no se comparte con nadie.

1. Entra en el panel de desarrolladores de Meta y crea una app nueva. En el caso de uso elige **«Other»** y en el tipo,
   **«Business»**. Si ya tienes una app que no es de tipo Business, crea otra: Instagram necesita una de este tipo.
2. Dentro de la app, añade el producto **Instagram** y pulsa **«Set up»**. Meta añade solo el apartado
   **«API setup with Instagram login»**, que es el que usarás. En el panel por casos de uso aparece como
   **«Manage messaging and content on Instagram»**.
3. Si Meta te lo propone, pulsa **«Add all required permissions»**: añade los dos permisos que hacen falta,
   `instagram_business_basic` e `instagram_business_manage_messages`.

Una persona puede ser desarrolladora o administradora de 15 apps como mucho si no están en un portfolio verificado.

Cómo se hace, en la documentación de Meta:
[Crear una app de Meta para Instagram](https://developers.facebook.com/documentation/development/create-an-app/other-app-types/instagram-apis)
y [el caso de uso de Instagram](https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case).

[Captura: el panel de la app con el producto Instagram y «API setup with Instagram login»]

## Token

El token es la llave con la que la app lee y responde los mensajes de la cuenta. Se añade la cuenta y se genera el
token en el panel de la app, sin programar nada:

1. En **Instagram › API setup with Instagram login**, en «Generate access tokens», pulsa **«Add account»**.
2. Entra con la **cuenta de Instagram del negocio** y acepta los permisos que pide.
3. Junto a la cuenta, pulsa **«Generate token»** y copia el token entero.

- El token dura **60 días**. No te preocupes: la app lo renueva sola cada semana (apartado «El panel de la cuenta»).
- Pégalo en «Token de la cuenta». La app lo guarda cifrado y nadie vuelve a verlo completo.
- No lo envíes por correo ni lo pegues en otro sitio: quien lo tenga puede leer y escribir los mensajes de la cuenta.

Dónde se genera, en la documentación de Meta:
[Empezar con la API de Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started).

[Captura: «Generate access tokens» con la cuenta del negocio añadida y el botón «Generate token»]

## Clave secreta

Con la clave secreta la app comprueba que cada aviso que le llega viene de verdad de Meta: los que no traen una firma
válida se rechazan sin guardar nada.

1. En **Instagram › API setup with Instagram login › Set up Instagram business login**, abre
   **«Business login settings»**.
2. Copia la **«Instagram app secret»** y pégala en «Clave secreta de Instagram».
3. **Opcional:** copia también la clave secreta de la app de Meta, que está en **App settings › Basic** («App
   secret»), y pégala en «Clave secreta de la app de Meta». Meta no dice cuál de las dos firma los avisos: con las dos
   guardadas, la app acepta la que sirva.

Las dos se guardan cifradas y nunca vuelven a la pantalla.

Dónde está, en la documentación de Meta:
[Inicio de sesión de empresa para Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login).

## Publicar la app

Meta solo envía los avisos de los mensajes a una **app publicada**.

1. En el panel de la app, entra en **Publish** y pulsa **«Go live»**.
2. Si Meta te pide una dirección de la política de privacidad, usa la de tu instalación:
   `https://tu-dominio/legal/privacidad`.
3. Si Meta te pide verificar la empresa para publicar, sigue sus pasos: depende de la app y de la cuenta.

Cómo se publica, en la documentación de Meta: [Publicar una app](https://developers.facebook.com/documentation/development/release)
y [la verificación de la empresa](https://developers.facebook.com/documentation/development/release/business-verification).

## Conectar en la app

1. En DominIA Agentes, entra en **Canales › Añadir canal › Instagram**. El primer paso, «Prepara tu app de Meta»,
   resume lo de arriba con los enlaces de Meta.
2. En «Conectar la cuenta», pega el **token**, la **clave secreta de Instagram** y, si quieres, la **clave secreta de
   la app de Meta**. Ponle un nombre al canal (solo lo ve tu equipo, por ejemplo «Instagram» o «@tu_cuenta») y elige
   el agente que contestará.
3. Pulsa **«Conectar cuenta»**. La app comprueba el token con Instagram, te enseña la cuenta (**@usuario**) y la
   suscribe a sus mensajes.
4. Si el token no vale, la app te dice por qué y no guarda nada. Una misma cuenta de Instagram solo se puede conectar
   una vez en la instalación.

## Avisos de Meta

El asistente te enseña dos datos con su botón de copiar: la **dirección de avisos** de esta cuenta (Callback URL) y su
**token de verificación** (Verify token). Cada cuenta tiene los suyos.

Meta guarda **una sola dirección de avisos por app**. Si conectas varias cuentas de Instagram con la misma app de Meta,
pega la dirección y el token de **una** de ellas (la primera que conectes): la app reparte los mensajes de cada cuenta
a su canal. No pegues después la de otra, porque sustituiría a la anterior; no hace falta.

1. En tu app de Meta, abre **Instagram › API setup with Instagram login › Configure webhooks**.
2. Pega la **Callback URL** y el **Verify token** y pulsa **«Verify and save»**. En cuanto Meta los comprueba, el paso
   «Avisos de Meta» del asistente se pone en verde.
3. En los campos de los avisos (Webhook fields), comprueba que **`messages`** está suscrito. Meta los suscribe todos
   por defecto; si lo quitaste, vuelve a suscribirlo. Los demás no hacen falta.

Si más tarde los necesitas otra vez, están en el panel del canal, en «Avisos de Meta» (solo para el propietario y los
administradores).

Cómo se configuran, en la documentación de Meta:
[Configurar los avisos de Instagram](https://developers.facebook.com/documentation/instagram-platform/webhooks).

[Captura: «Configure webhooks» con la Callback URL y el Verify token pegados y el campo messages suscrito]

## Permitir acceso a los mensajes

En la otra forma de conectar Instagram, Meta pide activar en la app de Instagram
**«Permitir acceso a los mensajes»**. Con esta forma puede que no haga falta, pero si la app te dice «La cuenta de
Instagram tiene desactivado el acceso de otras apps a sus mensajes», actívalo:

1. En la app de Instagram, con la cuenta del negocio, entra en **Configuración › Mensajes y respuestas a historias ›
   Herramientas conectadas**.
2. Activa **«Permitir acceso a los mensajes»**.
3. En el panel del canal, pulsa **«Revalidar»**.

El menú puede tener otro nombre en tu versión de Instagram. Así lo describe Meta:
[Mensajes de Instagram, primeros pasos](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/get-started).

## Prueba

1. Desde **otra cuenta de Instagram**, que no sea la del negocio ni tenga ningún papel en la app de Meta (por ejemplo,
   la personal de alguien de confianza), envía un mensaje directo a la cuenta del negocio.
2. El paso «Prueba» del asistente lo enseña en cuanto llega y, si hay un agente con la IA encendida, te contesta en unos
   segundos. También aparece en la **Bandeja**.

**Si no llega nada:**

- Revisa que la app de Meta esté publicada, que el paso «Avisos de Meta» esté en verde y que `messages` esté suscrito.
- Si con una cuenta que tiene papel en la app sí llega y con una ajena no, Meta está pidiendo **revisar la app**. La
  documentación de Meta no es clara en esto: en unos sitios dice que una app que solo usa la cuenta de su propio
  negocio no necesita revisión, y en otros que para recibir los avisos hace falta el acceso avanzado. En ese caso,
  pide la revisión como **«app para tu propio negocio»**, que además exige verificar la empresa:
  [revisión de una app para tu propio negocio](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-your-own-business).

## La ventana de 24 horas

- Instagram solo deja responder **hasta 24 horas después del último mensaje del cliente**, y el negocio **no puede
  escribir primero**.
- En la bandeja, una conversación de Instagram dice si la ventana está abierta y cuánto le queda. Cerrada, no se puede
  enviar nada hasta que el cliente vuelva a escribir («Han pasado más de 24 horas desde el último mensaje del cliente:
  Instagram no deja responder hasta que vuelva a escribir»), tampoco «Reintentar» un mensaje que falló; sí puedes
  dejar una nota interna.
- Fuera de la ventana la IA tampoco responde. Por eso Instagram no se usa para recordatorios ni envíos.

Lo explica Meta en [Enviar mensajes](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api).

## Solo texto

- La IA y tu equipo responden **solo con texto**. Desde la bandeja no se pueden enviar imágenes ni archivos por
  Instagram.
- Un mensaje tiene como mucho **1.000 bytes** (unos 900 caracteres; una letra con tilde ocupa 2 y un emoji 4). Si la
  respuesta de la IA es más larga (también un borrador suyo que apruebas sin cambiarlo), se corta con «…»; si la
  escribes tú desde la bandeja (o cambias un borrador), no se envía y te dice que la acortes. Nunca se parte en dos
  mensajes.
- Se reciben **texto**, **notas de voz** (se transcriben para que el agente las entienda), **imágenes** y **PDF**, que
  se descargan y se guardan en privado. Lo demás (vídeos, publicaciones, reels e historias compartidas, y las menciones
  en historias) aparece como «Tipo de mensaje no admitido» y la IA no lo contesta, aunque cuenta para la ventana de 24
  horas. De una historia (una mención o una respuesta a ella) nunca se guarda su dirección.
- Si el cliente borra un mensaje, también se borra en la app (y en la copia de los avisos que la app guarda unos días)
  y queda «El cliente borró este mensaje».
- Lo que contestes **desde la app de Instagram** entra en la conversación al momento, marcado «Desde Instagram», y
  pausa la IA en esa conversación, como cuando escribe una persona desde la bandeja: la IA no contesta encima de ti.

## El panel de la cuenta

En **Canales**, entra en el canal de Instagram:

- **Cuenta**: el @usuario, con el enlace a su perfil.
- **Token**: verde si Instagram lo acepta. Debajo, **hasta cuándo vale**.
- **Caducidad del token**: el token dura 60 días y **la app lo renueva sola cada semana**, también con el canal
  desactivado. Si Instagram rechaza la renovación porque el token ya no vale o le falta un permiso, el canal pasa a
  «Error» al momento («Instagram no ha renovado el token») y se avisa al propietario y a los administradores: genera
  uno nuevo (apartado «Token») y pulsa «Cambiar token». Si falla por otra cosa (la conexión, un error pasajero de
  Instagram), se vuelve a intentar en la próxima revisión (sale en ámbar) y pasa a «Error» si se acerca el final.
- **Recepción**: verde cuando Meta ha comprobado la dirección de avisos; en cada revisión la app vuelve a suscribir la
  cuenta a sus mensajes, por si Meta la dio de baja.
- **Último mensaje**: cuándo llegó el último.
- **Revalidar**: comprueba otra vez el token y vuelve a suscribir la cuenta a sus mensajes.
- **Cambiar token**: para poner uno nuevo de la misma cuenta. Solo sustituye al anterior si Instagram lo acepta.
- **Desconectar**: borra el token y las claves. El canal queda desactivado y conserva sus conversaciones; para volver a
  usarlo se conecta otra vez con el asistente.

La app revisa cada cuenta cada 6 horas y avisa si algo empeora.

## Problemas

- **«El token de Instagram no es válido o ha caducado».** Genera otro en tu app de Meta («Generate token») y pégalo
  entero; a veces se queda un espacio o falta un trozo.
- **«Esa cuenta no es profesional».** Pásala a cuenta de empresa o de creador en la app de Instagram y vuelve a generar
  el token.
- **«Esta cuenta de Instagram ya está conectada en otro canal de la instalación».** Cada cuenta va en un solo canal:
  usa el que ya tienes. Si ese canal está desconectado, vuelve a conectarlo desde su panel y conservas sus
  conversaciones.
- **«Ese token es de otra cuenta».** Al volver a conectar o al cambiar el token, tiene que ser de la misma cuenta. Para
  otra cuenta, añade un canal nuevo.
- **Meta no deja guardar la dirección de avisos («Verify and save»).** DominIA Agentes tiene que estar publicada con
  HTTPS, y la URL y el token de verificación tienen que ir tal cual, sin espacios. Cópialos con el botón de copiar.
- **Escribo a la cuenta y no llega nada.** Mira el apartado «Prueba». Pulsa también «Revalidar» en el panel: vuelve a
  suscribir la cuenta, por si Meta dejó de enviar los avisos después de varios fallos seguidos.
- **«La cuenta de Instagram tiene desactivado el acceso de otras apps a sus mensajes».** Mira el apartado «Permitir
  acceso a los mensajes».
- **No puedo responder a un cliente.** Han pasado más de 24 horas desde su último mensaje: tiene que escribir él
  (apartado «La ventana de 24 horas»).
- **Las respuestas tardan o no llegan.** Comprueba que hay un agente activo, que la IA del canal está encendida, que la
  conversación no está en pausa y que hay clave de OpenRouter en Ajustes › IA.
- **La IA dejó de responder en una conversación.** Si alguien contestó desde la app de Instagram, la IA se pausa en esa
  conversación como cuando escribe una persona; puedes reactivarla desde la bandeja.
