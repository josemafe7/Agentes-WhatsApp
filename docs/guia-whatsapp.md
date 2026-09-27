# Conectar WhatsApp

Esta guía explica, paso a paso, cómo conectar un número de WhatsApp del negocio a DominIA Agentes con la API oficial de Meta (WhatsApp Cloud API). Se hace una vez por número. En la app, el asistente está en **Canales › Añadir canal › WhatsApp**, y cada campo tiene un «¿Dónde lo encuentro?» que abre aquí el apartado que le toca.

Los menús de Meta cambian de vez en cuando de nombre o de sitio. Aquí van en español y, entre paréntesis, en inglés, porque Meta muestra algunas pantallas solo en inglés.

## Antes de empezar

Qué es cada cosa:

- **Portfolio empresarial** (business portfolio, antes «Business Manager»): la ficha del negocio en Meta. Ahí viven sus activos: la app, la cuenta de WhatsApp, los números y la facturación.
- **App de Meta**: la pieza con la que DominIA Agentes habla con WhatsApp. Se crea en developers.facebook.com, dentro del portfolio del negocio.
- **Cuenta de WhatsApp Business** (WABA): agrupa los números, las plantillas y la facturación de WhatsApp. Desde septiembre de 2026 Meta la va mostrando como dos cuentas, «WhatsApp account» (el número y su perfil) y «Messaging account» (plantillas, facturación y avisos). Los identificadores no cambian.
- **Usuario del sistema** y **token permanente**: una cuenta de servicio del portfolio, que no depende de ninguna persona, y la clave que usa la app para hablar con Meta en su nombre.
- **Webhook** (dirección de avisos): la dirección de tu app a la que Meta envía los mensajes que llegan.

Quién hace qué:

- **El negocio** (su propietario) crea el portfolio, da acceso a quien implanta, añade el método de pago y, cuando pueda, verifica la empresa. Todo queda a su nombre.
- **Quien implanta** crea la app en ese portfolio, el usuario del sistema y el token, y conecta el número en DominIA Agentes.

Qué necesitas:

- **La app publicada en internet con HTTPS** (guía «Publicar la app en Vercel», en Ayuda). En local puedes validar los datos, pero no llegan mensajes reales: el asistente lo avisa.
- Entrar en DominIA Agentes como **propietario o administrador**.
- Un **número de teléfono** que pueda recibir un SMS o una llamada y que no se vaya a usar en la app WhatsApp del móvil (apartado «Número»).
- Una **tarjeta** u otro método de pago para Meta (apartado «Método de pago»).

DominIA Agentes usa **solo la API oficial de Meta**, con la app del propio negocio: nada de apps no oficiales ni de compartir el número con la app del móvil.

**Consejo:** antes de conectar el número real, haz la prueba con el número de prueba de Meta (apartado «Número de prueba de Meta»). Solo necesita el portfolio, la app, el token y la app publicada, y comprueba que todo el camino funciona.

## Portfolio

**Lo hace el negocio**, en Meta Business Suite (business.facebook.com), con su propia cuenta de Facebook o de Meta.

1. Si el negocio ya tiene un **portfolio empresarial** (por ejemplo, el de su página de Facebook o sus anuncios), usa ese. Si no, créalo desde business.facebook.com con el nombre del negocio tal como aparece en sus documentos oficiales (lo necesitarás si un día verificas la empresa) y un email del negocio.
2. En la **Configuración** del portfolio (Settings), entra en **Usuarios › Personas** (Users › People) y añade a quien implanta con su email y **control total** (full control, lo que antes se llamaba acceso de administrador).
3. Esa persona recibe una invitación por email y la acepta.
4. Activa la verificación en dos pasos en la cuenta de Facebook o de Meta de cada persona con control total.

Por qué así:

- Todo lo que se crea después (la app, la cuenta de WhatsApp, el número y la facturación) queda en el portfolio del negocio. Si un día cambia quien lo mantiene, el negocio lo conserva todo y solo tiene que quitarle el acceso.
- **Nunca uses el portfolio de quien implanta ni el de otro cliente**: la app y el número quedarían a nombre de otro, y Meta rechaza el token con un error de permisos (200) si la app y el número no son del mismo portfolio.

[Captura: la pantalla Personas del portfolio del negocio, con quien implanta añadido con control total]

## App

**Lo hace quien implanta**, con su cuenta, una vez aceptada la invitación al portfolio del negocio.

1. Entra en developers.facebook.com › **Mis apps › Crear app** (My Apps › Create App). Si es la primera vez, Meta te pide darte de alta como desarrollador.
2. Escribe el nombre de la app (por ejemplo, «Peluquería Ejemplo Agentes») y un email de contacto del negocio. El nombre no puede incluir «WhatsApp», «Facebook», «FB» ni otras marcas de Meta.
3. En el caso de uso, elige **«Connect with customers through WhatsApp»** (conectar con clientes a través de WhatsApp).
4. En el portfolio empresarial, elige **el del negocio**. Es el paso más importante: la app va en ese portfolio.
5. Termina la creación y, en el panel de la app, pulsa **«Start using the API»** para abrir **API Setup** (configuración de la API). Si Meta pide aceptar las condiciones de la Cloud API, acéptalas. Meta puede crear sola una cuenta de WhatsApp Business con un número de prueba.
6. En **Roles de la app** (App roles), añade al propietario del negocio como administrador de la app. Así el negocio administra su propia app (apartado «El tope de 15 apps por persona»).

- **App ID** (identificador de la app): está en **Configuración de la app › Básica**. El asistente solo lo pide si Meta no lo devuelve al validar.
- **Una app vale para todos los números del negocio.** Si conectas otro número del mismo portfolio, usa la misma app: DominIA Agentes reutiliza sus datos y no hace falta volver a escribir el App Secret.
- **Cada app tiene una sola dirección de avisos.** Si el negocio ya usa esta app para otra herramienta (por ejemplo, un n8n), conectar DominIA Agentes cambiaría la dirección para toda la app y esa herramienta dejaría de recibir los mensajes de WhatsApp. Decide antes cuál de las dos atiende WhatsApp.

[Captura: la creación de la app con el caso de uso de WhatsApp y el portfolio del negocio elegido]

## Número

**Lo decide el negocio.** Aviso importante: **el número que conectes deja de funcionar en la app WhatsApp o WhatsApp Business del móvil.** DominIA Agentes no comparte el número con la app del móvil. En el primer paso del asistente tienes que marcar la casilla de que lo has entendido.

Qué número usar:

- **Recomendado:** un número nuevo para el agente (una línea móvil nueva o un fijo que pueda recibir SMS o llamadas). El número de siempre se queda en el móvil.
- **O** un número que el negocio acepte sacar de la app del móvil. Antes de añadirlo a Meta hay que borrar su cuenta en la app: en WhatsApp, **Ajustes › Cuenta › Eliminar cuenta**. Se pierde el historial de chats de ese móvil: exporta antes lo que quieras guardar.
- Tiene que poder recibir un **SMS o una llamada** para verificarlo. Con un fijo, mejor por llamada. Los números cortos no sirven.

Cómo se añade a Meta:

1. En el panel de la app › **WhatsApp › API Setup**, usa la opción para añadir un número de teléfono (Add phone number). También se puede desde WhatsApp Manager (el administrador de WhatsApp de Meta Business Suite).
2. Rellena el perfil: el **nombre visible** (el nombre del negocio que verán los clientes; Meta lo revisa), la categoría y la descripción.
3. Verifica el número con el código que llega por SMS o llamada. Si no lo haces aquí, el asistente de DominIA Agentes puede pedir el código por ti, en español.

- Añadir y verificar el número no basta: además hay que **registrarlo** para la API. Lo hace el asistente en su paso 3 (apartado «PIN»).
- El nombre visible sale siempre en el perfil, pero en la cabecera del chat y en la lista de chats **solo cuando Meta lo aprueba**.
- Sin verificar la empresa, el portfolio puede tener **2 números** registrados (apartado «Límites de Meta y verificación de la empresa»).

[Captura: API Setup con la opción para añadir un número de teléfono]

## Usuario del sistema

**Lo hace quien implanta**, en Meta Business Suite › **Configuración › Usuarios › Usuarios del sistema** (Settings › Users › System users).

El usuario del sistema es una cuenta de servicio del portfolio. Su token no depende de ninguna persona: sigue funcionando aunque alguien deje el negocio o cambie su contraseña.

1. Pulsa **«Añadir»** (Add), ponle un nombre (por ejemplo, «DominIA Agentes») y elige el rol:
   - **Administrador**: llega a todas las cuentas de WhatsApp del portfolio. Es lo más sencillo.
   - **Empleado**: llega solo a las cuentas que le asignes. Úsalo si el portfolio tiene otras cuentas de WhatsApp que no deben tocarse.
2. Pulsa **«Asignar activos»** (Assign assets) y dale:
   - la **app** que creaste, con control total (Manage app);
   - la **cuenta de WhatsApp** del número, con control total. Si tu Meta Business Suite ya muestra por separado «WhatsApp accounts» y «Messaging accounts», asígnale **las dos**.
3. Guarda. El token se genera en el apartado siguiente.

Si al validar Meta dice que el token no tiene permiso sobre el número (error 200), casi siempre falta asignar aquí un activo.

[Captura: el usuario del sistema con la app y la cuenta de WhatsApp asignadas]

## Token

El **token permanente** es la clave con la que DominIA Agentes habla con Meta en nombre del negocio. Va en el campo «Token permanente» del asistente.

1. En **Usuarios del sistema**, elige el usuario del apartado anterior y pulsa **«Generar token»** (Generate new token).
2. Elige **la app del negocio**.
3. En la caducidad, elige **«Nunca»** (Never).
4. Marca los **dos permisos de WhatsApp**: `whatsapp_business_management` y `whatsapp_business_messaging`. `business_management` es opcional.
5. Copia el token y pégalo directamente en el asistente. **Meta lo enseña una sola vez.**

- **No uses el token temporal de API Setup**: caduca enseguida.
- **No lo envíes** por email, WhatsApp ni chat, ni lo guardes en un documento. Si necesitas guardarlo, usa un gestor de contraseñas. DominIA Agentes lo guarda cifrado y solo lo muestra como `••••1234`.
- **«Validar con Meta»** comprueba que el token es válido, que es de la misma app y de un usuario del sistema, y que tiene los dos permisos. Si le falta algo, dice qué y no deja seguir. Si el token caduca, avisa y recomienda uno permanente.
- Para cambiarlo más adelante: en el panel del número, **«Cambiar token»**. El nuevo solo sustituye al anterior si Meta lo valida.

[Captura: la ventana «Generar token» con la caducidad «Nunca» y los dos permisos de WhatsApp marcados]

## App Secret

La **clave secreta de la app**. DominIA Agentes la usa para comprobar que cada aviso que llega viene de verdad de Meta (la firma de los avisos). Va en el campo «App Secret» del asistente.

1. En el panel de la app, ve a **Configuración de la app › Básica** (App settings › Basic).
2. Junto a **App Secret** (clave secreta de la app), pulsa **«Mostrar»** (Show). Meta te pide tu contraseña.
3. Cópiala y pégala en el asistente.

- En la misma página está el **App ID** (identificador de la app). El asistente solo lo pide si Meta no lo devuelve al validar.
- Si ya conectaste otro número con la misma app, no hace falta volver a escribirlo: se reutiliza.
- Si Meta te pide cambiar el App Secret (por ejemplo, porque cree que se ha filtrado), cámbialo también en el panel del número en DominIA Agentes; se actualiza en todos los números de esa app. Si no, los avisos se rechazan por la firma y no llegan mensajes.

[Captura: Configuración de la app › Básica, con el App ID y el App Secret oculto]

## Phone Number ID

El **identificador del número** en Meta. **No es el número de teléfono**: es una cifra larga. Va en el campo «Phone Number ID» del asistente.

1. En el panel de la app, ve a **WhatsApp › API Setup**.
2. Elige el número en **«From»** (de). Debajo aparece su **Phone number ID**: cópialo.
3. Pégalo en el asistente.

- En la misma pantalla está el **WhatsApp Business Account ID** (WABA ID). El asistente solo lo pide si Meta no lo devuelve al validar.
- Para la prueba con el número de prueba de Meta, copia el Phone number ID del número de prueba.

Con el nombre del canal, el token, el App Secret y el Phone Number ID, pulsa **«Validar con Meta»**. Si todo está bien, el asistente muestra **«Negocio · Número · Estado»**: el nombre verificado, el número, la calidad y el estado del nombre y de la verificación, para que confirmes que es el número correcto. Si algo falla, sale el error en español con qué hacer (apartado «Problemas»).

[Captura: API Setup con el Phone number ID y el WhatsApp Business Account ID]

## PIN

El **PIN de 6 cifras** de la verificación en dos pasos del número. Va en «Avanzado», en el paso 1 del asistente, y se usa al registrar el número en el paso 3.

- **Si el número ya tenía verificación en dos pasos** (por ejemplo, porque se usó antes con otra herramienta), escribe su PIN.
- **Si no la tenía, déjalo vacío.** Al registrar, el asistente crea un PIN nuevo, que pasa a ser el del número. No hace falta ponerlo antes en Meta.
- **Si no sabes el PIN**, o Meta dice que no es correcto (error 133005), el asistente ofrece **«Cambiar el PIN»** por uno nuevo y registra con él.
- Tiene que tener exactamente 6 cifras y se guarda cifrado.
- Desde el 23-09-2026 Meta va retirando el PIN en algunos números. Aun así, el registro sigue pidiendo uno de 6 cifras, y el asistente lo envía igual.
- En «Avanzado» también está la versión de la API de Meta (v26.0 por defecto). No la cambies salvo que te lo indique quien mantiene la app.

Qué hace el asistente en el paso 3 (activar):

1. Si el número no está verificado, pide el código por **SMS o llamada**, en español, y te deja escribirlo.
2. Si el número no está registrado, lo **registra** con el PIN. La primera vez lo hace solo, al abrir el paso. Meta permite **10 intentos de registro cada 72 horas** por número: si ya hubo alguno en las últimas 72 horas (un registro o una baja, por ejemplo al volver a conectar un número que diste de baja), el asistente te pide confirmación antes de cada intento nuevo y te dice cuántos quedan. Si se agotan (error 133016), hay que esperar 72 horas.

- El número de prueba de Meta ya viene registrado: este paso se salta.
- Si Meta aprueba un cambio del nombre visible, hay que **volver a registrar el número en 14 días** como máximo. El panel del número lo recuerda con el botón «Volver a registrar».

## Webhook

La **dirección de avisos** (webhook) es la dirección de tu app a la que Meta envía los mensajes que llegan y el estado de los que envías. Hay **una sola por instalación**:

```
https://tu-dominio/api/webhooks/whatsapp
```

- Siempre la del dominio de producción, con HTTPS válido. Nunca `localhost` ni la dirección de una versión de prueba de Vercel.
- Va con un **token de verificación** (verify token) propio de la instalación, que la app genera sola. Lo ves en el paso 2 del asistente y en **Ajustes › WhatsApp**.

Qué hace el asistente en el paso 2:

1. **Intenta suscribir la app solo.** Si la app de Meta ya tiene otra dirección de avisos (por ejemplo, la de un n8n del negocio), te avisa de que la sustituiría **para toda la app** y te pide confirmación. Si no confirmas, sigue por el camino manual.
2. **Si no puede**, te muestra la dirección y el token de verificación con botón de copiar. Entonces, en el panel de la app de Meta:
   - ve a **WhatsApp › Configuración** (WhatsApp › Configuration); si la app se creó con el caso de uso de WhatsApp, está en **Casos de uso › Personalizar › Configuración** (Use cases › Customize › Configuration);
   - pega la **URL de devolución de llamada** (Callback URL) y el **token de verificación** (Verify token);
   - pulsa **«Verificar y guardar»** (Verify and save): el asistente te avisa en directo cuando llega la verificación de Meta;
   - en los campos del webhook, suscribe `messages` (**imprescindible**) y los recomendados: `account_update`, `phone_number_quality_update`, `phone_number_name_update`, `message_template_status_update`, `template_category_update`, `message_template_quality_update`, `business_capability_update`, `account_alerts` y `security`.
3. **Siempre suscribe la app a la cuenta de WhatsApp del número** y comprueba que ha quedado. Sin esto no llegan mensajes, aunque la dirección esté bien. Repetirlo no hace daño.

- DominIA Agentes **nunca** pone una dirección de avisos distinta para una cuenta o un número concreto (lo que Meta llama «override»). Si otra herramienta lo hizo, el diagnóstico lo avisa y no lo toca sin tu confirmación.
- El panel de la app de Meta permite enviar avisos de prueba: llegan, se registran y no crean conversaciones.

[Captura: WhatsApp › Configuración en el panel de la app, con la URL, el token de verificación y el campo messages suscrito]

## Publicar app

**Sin la app de Meta publicada (en modo Live), no llegan los mensajes de los clientes reales**: mientras está en desarrollo, Meta no envía algunos avisos. Es la primera casilla de la lista del paso 3.

Qué pide Meta, en **Configuración de la app › Básica**:

- **Nombre visible** de la app, sin «WhatsApp», «Facebook», «FB» ni otras marcas de Meta.
- **Email de contacto**: recibe los avisos de Meta para desarrolladores.
- **URL de las condiciones del servicio** (Terms of Service URL): `https://tu-dominio/legal/terminos`.
- **Icono**, sin logotipos de Meta (tampoco el de WhatsApp).
- **Categoría** y **propósito** de la app.
- Conviene rellenar también la **URL de la política de privacidad** (Privacy Policy URL), `https://tu-dominio/legal/privacidad`, y la de **eliminación de datos** (User data deletion), `https://tu-dominio/legal/eliminacion-datos`.

Las tres páginas legales las sirve DominIA Agentes, son públicas (se ven sin iniciar sesión) y llevan los datos del negocio con un texto básico. Ábrelas en el navegador antes de pegarlas en Meta.

Después, en el panel de la app, pulsa **Publicar** (Publish) y **Go live**.

- **No hace falta App Review ni verificar la empresa** para publicar: la app solo accede a los datos del propio negocio.
- La API de Meta no dice si la app está publicada, así que el asistente te pide marcar a mano **«App publicada (Live)»**. Márcala solo cuando el panel de Meta diga que está en Live.

[Captura: el panel de la app de Meta en modo Live]

[Captura: Configuración de la app › Básica con las tres direcciones legales rellenadas]

## Método de pago

**Lo hace el negocio**, en Meta Business Suite › **Centro de facturación** (Billing Hub) › **Métodos de pago** (Payment methods): añade una tarjeta u otro método de pago a la cuenta de WhatsApp.

Por qué hace falta:

- Desde el **1-10-2026**, Meta cobra los **mensajes de servicio** (las respuestas dentro de las 24 horas desde el último mensaje del cliente, también las de la IA) a la misma tarifa que las plantillas de utilidad de cada país.
- Cada número tiene **1.000 mensajes de servicio gratis al mes**. No se acumulan de un mes a otro.
- **Sin método de pago, Meta deja de entregar los mensajes de servicio cuando se acaban los 1.000 gratis del mes.**
- Las plantillas se cobran según su categoría. Desde el 1-10-2026, también las de utilidad enviadas dentro de las 24 horas, sin tramo gratis.

En DominIA Agentes:

- La API no deja comprobar el método de pago, así que el asistente **no te deja terminar hasta que confirmes a mano** que lo has añadido, con un enlace al Centro de facturación. Con el número de prueba de Meta no se pide.
- Si empiezan a fallar envíos por el método de pago (error 131042), o fallan mensajes de servicio después de haber gastado los 1.000 gratis del mes, el panel del número avisa **«Puede que falte el método de pago en Meta»** y avisa al propietario y a los administradores.
- La IA envía **una sola respuesta por cada turno del cliente**, aunque escriba varios mensajes seguidos: cada mensaje cuenta.
- **Coste estimado:** en **Ajustes › WhatsApp** escribes las tarifas de Meta por país y categoría, sacadas de sus tablas oficiales: https://business.whatsapp.com/products/platform-pricing#rates. La app no trae precios porque Meta los cambia (solo el 1 de enero, abril, julio u octubre). Los mensajes gratis no se configuran: Meta marca en cada mensaje si fue gratis, y la app lo cuenta como 0.

[Captura: el Centro de facturación de Meta con el método de pago añadido a la cuenta de WhatsApp]

## Plantillas

Cuando han pasado más de 24 horas desde el último mensaje del cliente, WhatsApp **solo deja enviar plantillas aprobadas** por Meta. La IA no escribe fuera de esa ventana; una persona puede enviar una plantilla desde la bandeja.

1. Crea las plantillas en **WhatsApp Manager**, dentro de la cuenta de WhatsApp del negocio: nombre, idioma (español), categoría y texto con sus datos variables (por ejemplo, `{{nombre}}`). Meta las revisa antes de aprobarlas.
2. En DominIA Agentes, pulsa **«Sincronizar plantillas»**, en el paso 3 del asistente o en el apartado **Plantillas** del panel del número (Canales › el canal). Trae cada plantilla con su estado, categoría, idioma y variables.
3. Cuando Meta aprueba o cambia una plantilla, se actualiza sola.

- Solo se pueden enviar las **aprobadas**.
- **Categorías:** marketing, utilidad (por ejemplo, un recordatorio de cita) y autenticación. Cada una tiene su tarifa (apartado «Método de pago»).
- Sin verificar la empresa, cada cuenta puede tener hasta **250 plantillas**.
- En la bandeja, al elegir una plantilla, rellenas sus datos y ves cómo queda antes de enviarla.

[Captura: el apartado Plantillas del panel del número con el estado y la categoría de cada plantilla]

## Prueba

Paso 4 del asistente: comprobar que los mensajes llegan y salen.

1. Desde tu WhatsApp personal (no desde el número del negocio), escribe **«hola»** al número que acabas de conectar. El asistente te lo recuerda con «Escribe "hola" a» y el número.
2. El mensaje aparece en el asistente en cuanto llega.
3. Pulsa **«Enviar respuesta de prueba»**: te llega al móvil. Es un mensaje de servicio dentro de las 24 horas, así que cuenta entre los 1.000 gratis del mes.

**Si en 2 minutos no llega nada**, el asistente abre un diagnóstico guiado y marca lo que puede comprobar solo:

- que la app de Meta envía los avisos a esta instalación;
- que ninguna otra herramienta desvía los avisos del número;
- que el campo `messages` está suscrito;
- que la app está suscrita a la cuenta de WhatsApp;
- que llegó la verificación de Meta (si no, la dirección o el token están mal copiados, o el HTTPS no es válido);
- que ningún aviso se ha rechazado por la firma (si los hay, el App Secret no es el de esta app);
- que la app está publicada (Live): esto lo compruebas tú en el panel de Meta;
- que el número puede enviar.

Después, en el paso 5, eliges el **agente activo**, enciendes o apagas la IA y revisas el **modo pruebas «solo a estos números»**, que viene activado: mientras lo esté, la IA solo contesta a los números de la lista y los demás mensajes esperan en la bandeja a una persona. Añade tu número, pruébalo y, cuando todo vaya bien, desactiva el modo pruebas desde el canal para que la IA atienda a todos los clientes.

[Captura: el paso 4 del asistente con el «hola» recibido y el botón «Enviar respuesta de prueba»]

## Número de prueba de Meta

Haz esta comprobación **en cuanto la app esté publicada en internet con HTTPS**, antes de conectar el número real. Es la primera prueba con Meta de verdad y no necesita número propio, registro ni método de pago. Meta suele crear el número de prueba al crear la app con el caso de uso de WhatsApp. Ya viene registrado y **solo puede escribir a los destinatarios que añadas** en su pantalla.

Necesitas hechos antes los apartados «Portfolio», «App», «Usuario del sistema», «Token» y «App Secret», y la app de Meta publicada («Publicar app»).

1. **Añade tu número como destinatario.** En el panel de la app › **WhatsApp › API Setup**, elige el número de prueba en «From» y añade tu número de WhatsApp personal en **«To»** (para). Si Meta te pide confirmarlo con un código que llega a ese WhatsApp, escríbelo.
2. **Copia el Phone number ID del número de prueba**, en la misma pantalla.
3. **Genera el token permanente** del usuario del sistema (apartado «Token»). No uses el token temporal de API Setup.
4. **Abre el asistente** en DominIA Agentes: **Canales › Añadir canal › WhatsApp**. En el paso 0, elige **«Número de prueba de Meta»** y marca la casilla.
5. **Paso 1:** escribe un nombre (por ejemplo, «WhatsApp prueba»), el token, el App Secret y el Phone Number ID del número de prueba. Pulsa **«Validar con Meta»**: tiene que salir «Negocio · Número · Estado» con el número de prueba.
6. **Paso 2:** deja que el asistente suscriba la dirección de avisos o hazlo a mano (apartado «Webhook»). Comprueba que llegó la verificación de Meta y que la app quedó suscrita a la cuenta de WhatsApp.
7. **Paso 3:** el registro se salta, porque el número de prueba ya viene registrado, y no se pide método de pago. Marca «App publicada (Live)» cuando lo esté. Si quieres, pulsa «Sincronizar plantillas».
8. **Paso 4:** desde tu WhatsApp personal, escribe **«hola»** al número de prueba. Tiene que aparecer en el asistente. Pulsa **«Enviar respuesta de prueba»** y comprueba que te llega.
9. **Mira la Bandeja:** abre **Bandeja** y busca la conversación con tu número. Tienen que estar tu «hola» y la respuesta de prueba, y la respuesta pasa a enviado y, después, a entregado o leído (Meta no siempre avisa del «entregado»).
10. **Paso 5:** elige el agente, enciende la IA y deja el modo pruebas con tu número. Escribe una pregunta sobre el negocio: el agente responde **una sola vez**, aunque mandes dos o tres mensajes seguidos. Hace falta la clave de OpenRouter.
11. **Archivos:** si quieres, envía una nota de voz y una foto. Aparecen en la bandeja y la nota de voz se transcribe (también con la clave de OpenRouter).
12. **Diagnóstico:** en **Ajustes › Diagnóstico** se ve la hora del último aviso recibido de ese canal.

Si todo esto funciona, la conexión con Meta está bien hecha: ya puedes conectar el número real del negocio, empezando por el apartado «Número». El canal de prueba puedes dejarlo o desconectarlo desde su panel. Si algo falla, mira «Problemas».

[Captura: API Setup con el número de prueba en «From» y tu número añadido en «To»]

[Captura: la Bandeja con la conversación de prueba y el estado de la respuesta]

## Después de conectar

- **Panel del número** (Canales › el canal): semáforos verde, ámbar o rojo, con su explicación, para el token, el registro, la suscripción, los avisos, el último mensaje, la calidad, el nombre, el límite de mensajes, el envío, el método de pago y la versión de la API.
- La app revisa cada número **cada 6 horas** y cuando Meta avisa de cambios. Si algo empeora, lo muestra en el panel y avisa al propietario y a los administradores.
- **Botones del panel:** «Revalidar», «Cambiar token», «Pausar IA» y «Desconectar». Desconectar borra las credenciales y, si lo confirmas, también quita la suscripción y da de baja el número en Meta (cuenta como uno de los 10 intentos cada 72 horas).
- **Varios números:** cada número es un canal, con su agente, su modo pruebas y su panel. Todos usan la misma dirección de avisos y, si son del mismo portfolio, comparten el límite de mensajes.
- **Ventana de 24 horas:** la bandeja muestra si está abierta. Si está cerrada, solo deja enviar una plantilla aprobada.

## Límites de Meta y verificación de la empresa

Se puede empezar sin verificar la empresa. Estos son los límites:

- **Límite de mensajes:** cuántos clientes distintos puedes contactar **fuera de la ventana de 24 horas** (en la práctica, con plantillas) en 24 horas. Es del portfolio y lo comparten todos sus números. Empieza en **250**. Responder a quien te escribe, dentro de las 24 horas, no cuenta.
- Sube a **2.000** al verificar la empresa o al enviar plantillas de buena calidad a 2.000 clientes distintos en 30 días. Después sube solo a 10.000, 100.000 e ilimitado si la calidad es buena y usas al menos la mitad del límite.
- **Números:** **2 números** registrados por portfolio. Pasan a 20 al verificar la empresa o al llegar al límite de 2.000.
- **Nombre visible:** hasta que Meta lo aprueba, solo se ve en el perfil, no en la cabecera del chat.
- **Plantillas:** 250 por cuenta sin verificar; hasta 6.000 con la empresa verificada y el nombre aprobado.
- **Apps:** 15 por persona sin empresa verificada (apartado siguiente).
- **Asistentes de IA de propósito general:** prohibidos en WhatsApp desde el 15-01-2026. Los agentes de DominIA Agentes solo hablan de los temas del negocio y siempre pueden pasar a una persona. No presentes el agente como un asistente para todo.

Cuándo conviene verificar la empresa:

- cuando necesites escribir primero (con plantillas) a más de 250 clientes distintos al día, por ejemplo con los recordatorios de una agenda llena;
- cuando quieras más de 2 números;
- cuando quien implanta se acerque al tope de 15 apps.

La verificación la pide el negocio, porque va a su nombre, desde la configuración del portfolio en Meta Business Suite, en el apartado de verificación del negocio. Meta pide documentos oficiales del negocio.

## El tope de 15 apps por persona

- Meta deja que cada persona tenga **como máximo 15 apps** en las que es desarrolladora o administradora y que **no estén conectadas a una empresa verificada**. Las apps archivadas también cuentan.
- Quien implanta DominIA Agentes en varios negocios crea una app por negocio y llega pronto al tope.

Por eso:

- el negocio **administra su propia app**: su propietario es administrador de la app, además de quien implanta (apartado «App»);
- el negocio **verifica su empresa cuando pueda**: las apps conectadas a una empresa verificada no cuentan para el tope;
- cuando quien implanta deja de mantener la instalación, el negocio le quita el rol en la app y el acceso al portfolio.

## Problemas

Cada error de Meta tiene un número (código). Estos son los más frecuentes, con el mensaje que ves en la app, su causa y la solución.

### Al validar con Meta

- **«El token no es válido o ha caducado. Genera uno nuevo en Usuarios del sistema.» (190 o 0).** Causa: el token está incompleto, se revocó o era el temporal de API Setup. Solución: genera uno nuevo con caducidad «Nunca» (apartado «Token») y pégalo entero.
- **«Algún dato no es correcto (por ejemplo, el Phone Number ID).» o «El Phone Number ID no es correcto o el token no tiene acceso a él.» (100 u 803).** Causa: pegaste el número de teléfono en lugar de su identificador, o el de otro número. Solución: copia el Phone number ID de API Setup (apartado «Phone Number ID»).
- **«El token no tiene acceso a esta cuenta o a este número.» o «El token no tiene permiso sobre este número…» (200, también 10 o 3).** Causa: al usuario del sistema le falta la app o la cuenta de WhatsApp en sus activos, o la app está en un portfolio distinto del número. Solución: asigna los activos (apartado «Usuario del sistema»), comprueba que la app está en el portfolio del negocio y vuelve a validar; si sigue igual, genera un token nuevo.
- **«Al token le falta el permiso …».** Causa: al generar el token no se marcó `whatsapp_business_management` o `whatsapp_business_messaging`. Solución: genera otro token con los dos permisos.
- **«El App ID o el App Secret no son correctos, o el token es de otra app.»** Causa: el App Secret es de otra app o está mal copiado, o el token se generó eligiendo otra app. Solución: copia de nuevo el App Secret de la misma app con la que generaste el token (apartado «App Secret»).
- **«El token pertenece a otra app.»** Causa: al generar el token elegiste otra app. Solución: genera el token eligiendo la app del negocio.
- **«El token no es de un usuario del sistema. Genera uno permanente en Usuarios del sistema.»** Causa: es un token personal o el temporal de API Setup; la app no deja seguir con él. Solución: genera el token desde Usuarios del sistema con caducidad «Nunca».
- **«Este número ya está conectado en otro canal de la instalación.»** Causa: ya hay un canal con ese número. Solución: usa ese canal («Revalidar» o «Cambiar token» en su panel).
- **«Meta está limitando las consultas. Inténtalo en unos minutos.» (4 u 80007).** Causa: demasiadas consultas a Meta en poco tiempo. Solución: espera unos minutos y vuelve a validar.

### Al activar el número

- **«Demasiados intentos de registro. Espera 72 horas.» (133016).** Causa: el número ya se ha registrado o dado de baja 10 veces en 72 horas. Solución: espera 72 horas; el asistente te dice cuántos intentos quedan antes de cada uno.
- **«El PIN no es correcto.» (133005).** Causa: el número tenía otro PIN de verificación en dos pasos. Solución: escribe el PIN correcto o pulsa «Cambiar el PIN» y registra con el nuevo.
- **«Primero hay que verificar el número con el código.» (133006).** Causa: Meta todavía no ha comprobado que el número es tuyo. Solución: pide el código por SMS o llamada en el asistente y escríbelo.
- **«Este número ya está verificado.» (136024).** Causa: se pidió un código para un número que ya estaba verificado. Solución: ninguna, sigue con el registro.
- **«El número no está registrado. Termina el paso de activación.» (133010 o 131045).** Causa: el número se añadió en Meta pero no se registró para la API. Solución: vuelve al paso 3 del asistente.
- **«Hay un desregistro a medias. Hay que desregistrar de nuevo.» (133000).** Causa: falló una baja anterior del número. Solución: desconecta el canal dando de baja el número en Meta y vuelve a conectarlo.
- **«El número se borró hace poco. Espera 5 minutos.» (133015).** Causa: el número se borró en Meta hace nada. Solución: vuelve a intentarlo en 5 minutos.
- **No llega el código por SMS.** Causa: es un fijo, o el número no recibe SMS. Solución: pide el código por llamada.
- **Meta no deja añadir el número porque ya está en uso en WhatsApp.** Causa: el número sigue en la app WhatsApp o WhatsApp Business de un móvil. Solución: borra su cuenta en la app (apartado «Número») y vuelve a añadirlo.

### No llegan los mensajes

- **«La app no tiene una dirección pública con HTTPS: puedes validar los datos, pero no llegarán mensajes reales.»** Causa: DominIA Agentes funciona en local o sin HTTPS. Solución: publica la app (guía «Publicar la app en Vercel») y conecta el número desde el dominio de producción.
- **«No ha llegado la verificación de Meta: revisa la dirección, el token y que el HTTPS sea válido.»** Causa: la dirección o el token de verificación están mal copiados, el certificado no es válido o pegaste la dirección de una versión de prueba. Solución: copia de nuevo la dirección y el token del paso 2 (o de Ajustes › WhatsApp) y pulsa «Verificar y guardar» en Meta.
- **«La app no está suscrita a la cuenta de WhatsApp Business: no llegarán mensajes.»** Causa: falta la suscripción de la app a la cuenta del número. Solución: pulsa «Revalidar» en el panel del número; si sigue igual, revisa los activos del usuario del sistema.
- **«Falta suscribir el campo «messages» en la app de Meta.»** Causa: el campo `messages` no está marcado en el webhook. Solución: en WhatsApp › Configuración de la app de Meta, suscribe `messages` (apartado «Webhook»).
- **Los avisos de prueba del panel de Meta llegan, pero los mensajes de los clientes no.** Causa: la app de Meta sigue en desarrollo. Solución: publícala (apartado «Publicar app»).
- **En Diagnóstico aparecen avisos rechazados por la firma.** Causa: el App Secret guardado no es el de la app, o Meta lo cambió. Solución: copia el App Secret actual y cámbialo en el panel del número.
- **«Otra integración desvía los avisos de este número o de su cuenta (override). No se toca sin tu confirmación.»** Causa: otra herramienta puso una dirección de avisos propia para ese número o su cuenta. Solución: quítala desde esa herramienta o confirma en DominIA Agentes que quieres quitarla.
- **Otra herramienta del negocio (por ejemplo, un n8n) ha dejado de recibir los mensajes de WhatsApp.** Causa: cada app de Meta tiene una sola dirección de avisos y ahora es la de DominIA Agentes. Solución: decide cuál de las dos atiende WhatsApp; si hacen falta las dos, cada una necesita su propia app.
- **Con el número de prueba, los mensajes de otra persona no llegan.** Causa: el número de prueba solo funciona con los destinatarios añadidos en «To». Solución: añade su número en API Setup.

### Al enviar

- **«La ventana de 24 h está cerrada. Usa una plantilla aprobada.» (131047).** Causa: han pasado más de 24 horas desde el último mensaje del cliente. Solución: envía una plantilla aprobada desde la bandeja (apartado «Plantillas»).
- **«Falta un método de pago válido en WhatsApp Manager.» (131042), o el aviso «Puede que falte el método de pago en Meta».** Causa: la cuenta de WhatsApp no tiene método de pago, o no es válido. Solución: añádelo en el Centro de facturación (apartado «Método de pago»).
- **«No se pudo entregar: el cliente no tiene WhatsApp o debe actualizarlo.» (131026).** Causa: el número no tiene WhatsApp, no ha aceptado sus condiciones o usa una versión antigua. Solución: contacta con el cliente por otra vía.
- **«Meta ha restringido la cuenta de WhatsApp por su política.» (368) o «La cuenta está bloqueada o el PIN no es correcto.» (131031).** Causa: Meta ha limitado o bloqueado la cuenta por incumplir su política. Solución: revisa el aviso de Meta en Business Support y en el semáforo «Envío» del panel.
- **«Meta limita los envíos de este número por su calidad.» (131048).** Causa: muchos clientes han bloqueado o denunciado los mensajes del número. Solución: revisa qué se envía, sobre todo las plantillas de marketing, y mira el semáforo «Calidad».
- **«Demasiados mensajes seguidos a este cliente; se reintentará.» (131056) o «Estamos enviando demasiado rápido; se reintentará.» (130429).** Causa: se ha superado el ritmo de envío de Meta. Solución: ninguna, la app lo reintenta sola con esperas crecientes.
- **«La plantilla no existe en ese idioma o no está aprobada.» (132001).** Causa: la plantilla se borró, cambió o está pendiente. Solución: pulsa «Sincronizar plantillas» y elige una aprobada.
- **«La plantilla necesita otro número de datos.» (132000).** Causa: faltan o sobran datos variables. Solución: rellena todos los datos de la plantilla.
- **«La plantilla está en pausa por baja calidad.» (132015) o «La plantilla está desactivada. Crea otra.» (132016).** Causa: los clientes han valorado mal la plantilla. Solución: edítala en WhatsApp Manager o crea otra.
- **«No se puede enviar un mensaje al propio número del negocio.» (131021).** Causa: la prueba se hizo desde el mismo número conectado. Solución: escribe desde otro WhatsApp.
- **«El número de prueba 555 necesita un nombre visible aprobado.» (131037).** Causa: Meta aún no ha aprobado el nombre de ese número. Solución: espera a la aprobación.
- **La IA no contesta.** Causa: el modo pruebas está activado y el número no está en la lista, el canal no tiene agente activo, la IA está apagada o en pausa porque respondió una persona, falta la clave de OpenRouter, el canal no responde fuera de horario o la ventana de 24 horas está cerrada. Solución: revisa la tarjeta del canal y el panel; los mensajes esperan en la bandeja a una persona.

### Otros problemas

- **El nombre del negocio no sale en la cabecera del chat.** Causa: Meta todavía no ha aprobado el nombre visible. Solución: espera; mientras, sale en el perfil.
- **«Pasaron 14 días sin volver a registrar el número: pide otra vez la revisión del nombre.»** Causa: Meta aprobó un cambio de nombre y no se volvió a registrar el número a tiempo. Solución: pide de nuevo la revisión del nombre en WhatsApp Manager y, cuando la aprueben, pulsa «Volver a registrar» antes de 14 días.
- **Meta no me deja crear otra app.** Causa: has llegado al tope de 15 apps sin empresa verificada (también cuentan las archivadas). Solución: que el negocio verifique su empresa o que cree la app desde la cuenta de su propietario (apartado «El tope de 15 apps por persona»).
