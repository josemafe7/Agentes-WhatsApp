# Conectar el correo

Esta guía explica, paso a paso, cómo conectar un buzón de correo del negocio a DominIA Agentes para que el agente lea los correos de los clientes y les responda en el mismo hilo. Se hace una vez por buzón. En la app, el asistente está en **Canales › Añadir canal › Correo**, y cada campo tiene un «¿Dónde lo encuentro?» que abre aquí el apartado que le toca.

Los menús de Google y de Microsoft cambian de vez en cuando de nombre o de sitio. Aquí van con su nombre en inglés, que es como salen con la consola en inglés, y entre paréntesis una traducción. Si tu consola está en español, busca el nombre traducido.

## Antes de empezar

Hay tres formas de conectar un buzón. Elige según dónde está el correo:

- **Gmail**: cuentas @gmail.com y correo de **Google Workspace** (Gmail con el dominio del negocio). El negocio crea su propia app de Google y nadie tiene que dar la contraseña del buzón. Apartados «Gmail» a «Producción».
- **Outlook / Microsoft 365**: cuentas de Outlook.com, Hotmail o Live y correo de **Microsoft 365** (Outlook con el dominio del negocio). El negocio registra su propia app en Microsoft Entra. Es la única forma de conectar un buzón de Microsoft. Apartados «Outlook» a «Consentimiento (admin)».
- **Otro (IMAP/SMTP)**: todo lo demás: el correo del hosting con dominio propio (IONOS, Hostinger, OVH, STRATO, cPanel…), Yahoo, iCloud, Zoho o GMX. Con la contraseña del buzón o con una contraseña de aplicación. Apartados «IMAP» y «Contraseña de aplicación».

Si el correo es de tu dominio y no sabes dónde está, fíjate en dónde lo lees: si entras en Gmail, es Google Workspace; si entras en Outlook con una cuenta de trabajo, es Microsoft 365; si entras en el webmail de tu hosting, es «Otro». Si sigues con dudas, pregúntaselo a quien te gestiona el dominio.

Qué es cada cosa:

- **Client ID** y **Client Secret**: el identificador y la clave de la app del negocio en Google o en Microsoft. Con ellos, DominIA Agentes pide permiso al buzón en nombre del negocio. El Client Secret es una clave: trátalo como una contraseña.
- **Dirección de redirección** (redirect URI): la dirección de tu app a la que Google o Microsoft te devuelven después de dar permiso. El asistente la muestra con un botón de copiar, y tiene que estar escrita igual, letra a letra, en Google o en Microsoft.
- **Tenant** (directorio): la organización del negocio en Microsoft. Su identificador es el **Tenant ID**.
- **IMAP** y **SMTP**: las dos puertas de un servidor de correo. Por IMAP se leen los correos y por SMTP se envían.
- **Contraseña de aplicación**: una contraseña aparte, solo para un programa, que algunos proveedores exigen para IMAP y SMTP.

Quién hace qué:

- **Todo es del negocio.** El proyecto de Google Cloud y la app de Microsoft Entra se crean con una cuenta del propio negocio. **Nunca uses la app de Google o de Microsoft de quien implanta ni la de otro negocio**: cada negocio tiene la suya, con sus propios límites y permisos, y si un día cambia quien lo mantiene, el negocio no pierde nada.
- Lo más sencillo es que **quien implanta lo haga junto al negocio**, con la cuenta del negocio y siguiendo esta guía. Nadie tiene que enviar contraseñas ni claves por email o por chat.

Qué necesitas:

- Entrar en DominIA Agentes como **propietario o administrador**.
- **La app publicada en internet con HTTPS**, mejor con un dominio propio (guía «Publicar la app en Vercel», en Ayuda). La app lee cada buzón una vez por minuto con su trabajo en segundo plano: en Vercel hace falta el cron cada minuto (apartado «6. El cron cada minuto» de esa guía).
- **Para probar en local también vale**: Google y Microsoft aceptan `http://localhost` en la dirección de redirección, y el correo no necesita una dirección pública. Solo se lee mientras la app esté arrancada en tu ordenador. Cuando la publiques, añade en Google o en Microsoft la dirección de redirección de producción (se pueden tener varias) y conecta el buzón desde la app publicada.
- Con Gmail u Outlook: la **cuenta del negocio** con la que se crea la app y la **cuenta del buzón** que se conecta (pueden ser la misma).
- Con «Otro»: la **contraseña del buzón** o una contraseña de aplicación.

**Solo se atienden los correos que llegan después de conectar el buzón**: el correo antiguo no se contesta nunca.

## Gmail

Para cuentas @gmail.com y de Google Workspace. El negocio crea su propio proyecto de Google Cloud, con una app que solo usan sus buzones, y DominIA Agentes la usa para leer el correo, etiquetarlo, dejar borradores y enviar las respuestas. No hace falta la contraseña del buzón.

En orden:

1. **Google Cloud**: el proyecto del negocio, con la Gmail API activada.
2. **Pantalla de consentimiento**: «Internal» con Google Workspace o «External» con @gmail.com.
3. **Credenciales**: el cliente «Web application» con la dirección de redirección. Te da el Client ID y el Client Secret.
4. **Producción**: con «External», publicar la app en producción. **Nunca en «Testing»**.
5. **El asistente de DominIA Agentes**, como se explica aquí debajo.

En DominIA Agentes:

1. Entra en **Canales › Añadir canal › Correo** y elige **Gmail**. Escribe un nombre para el canal (por ejemplo, «Correo de reservas»).
2. Copia la **dirección de redirección** del asistente con su botón y pégala en Google (apartado «Credenciales»). Es como esta: `https://tu-dominio/api/oauth/google/callback`.
3. Pega el **Client ID** y el **Client Secret** y guárdalos.
4. Pulsa **«Conectar con Google»**. Se abre Google: entra con la **cuenta del buzón** que quieres conectar.
5. Con «External», Google avisa de que no ha verificado la app: sigue como explica el apartado «Producción».
6. En la pantalla de permisos, **marca todas las casillas** y pulsa **Continue** (continuar). Google deja desmarcar permisos: si falta alguno, la app lo dice y no conecta.
7. Vuelves a DominIA Agentes, que comprueba los permisos concedidos (leer y modificar el correo, y ver el email de la cuenta) y muestra la dirección conectada. Si algo falla, sale el motivo en español (apartado «Problemas»).
8. Elige el modo de respuesta, el agente, la IA, la firma y los topes diarios (apartado «Modo de respuesta y filtros»).

**¿Prefieres contraseña de aplicación? Usa Otro.** El asistente de Gmail tiene ese enlace. Con «Otro» te ahorras el proyecto de Google Cloud, pero la cuenta necesita la verificación en dos pasos, muchas cuentas de Google Workspace no pueden crear contraseñas de aplicación y, si cambia la contraseña de la cuenta, Google la anula y hay que volver a conectar. Por eso recomendamos la opción Gmail (apartado «Contraseña de aplicación»).

[Captura: el asistente de correo con Gmail elegido, la dirección de redirección con su botón de copiar y el botón «Conectar con Google»]

## Google Cloud

**Lo hace el negocio**, o quien implanta con la cuenta del negocio, en https://console.cloud.google.com.

Con qué cuenta:

- **Google Workspace**: con una cuenta de la organización del negocio, mejor la de un administrador. Así el proyecto queda dentro de la organización y la app puede ser «Internal».
- **@gmail.com**: con la misma cuenta de Gmail del buzón, o con otra cuenta de Google del negocio.

1. Entra en https://console.cloud.google.com con esa cuenta. Si es la primera vez, acepta las condiciones de Google Cloud.
2. Crea un proyecto: en el selector de proyectos de arriba, **New project** (proyecto nuevo), o en el menú, **IAM & Admin › Create a Project** (IAM y administración › crear un proyecto).
3. En **Project name** (nombre del proyecto) escribe, por ejemplo, «DominIA Agentes». Con Google Workspace, en **Location** (ubicación) elige la organización del negocio. Pulsa **Create** (crear).
4. Comprueba que el proyecto nuevo está elegido en el selector de arriba.
5. Activa la Gmail API: en el menú, **APIs & Services › Library** (APIs y servicios › biblioteca), busca «Gmail API», ábrela y pulsa **Enable** (habilitar).

- **Un proyecto por negocio**: nunca el de otro negocio ni el de quien implanta. Si el negocio conecta varios buzones (por ejemplo, `info@…` y `reservas@…`), puede usar el mismo proyecto y el mismo cliente para todos: cada buzón es un canal.
- Sin la Gmail API activada, al conectar sale «La API de Gmail no está activada en tu proyecto de Google Cloud…».
- Con el correo de un negocio, la Gmail API no tiene coste: su uso queda muy por debajo del umbral a partir del cual Google ha anunciado que cobrará.

[Captura: la biblioteca de APIs de Google Cloud con la Gmail API habilitada]

## Pantalla de consentimiento

Es la pantalla que enseña Google cuando alguien conecta un buzón: qué app pide acceso y a qué. Se configura en **Google Auth Platform**, dentro del proyecto.

1. En el menú, **Google Auth Platform › Branding** (marca). Si aún no está configurada, pulsa **Get started** (comenzar).
2. En **App information** (información de la app): **App name** (nombre de la app), por ejemplo «Peluquería Ejemplo Agentes», sin «Google» ni «Gmail»; y **User support email** (email de asistencia), un email del negocio.
3. En **Audience** (público), elige el tipo de usuario:

- **Internal** (interno) si el buzón es de **Google Workspace** y el proyecto es de su organización. Solo pueden conectar cuentas de la organización, Google no enseña el aviso de app sin verificar, no hay tope de usuarios y no hay que publicar nada. Es lo recomendado siempre que se pueda.
- **External** (externo) si el buzón es **@gmail.com**, o si el proyecto no es de la organización. Después hay que publicar la app en producción (apartado «Producción»).

4. En **Contact information** (datos de contacto), un email del negocio para los avisos de Google.
5. Acepta la política de datos de usuario de los servicios de API de Google y pulsa **Create** (crear).
6. En **Data Access** (acceso a los datos) › **Add or remove scopes** (añadir o quitar permisos), añade `openid`, el del email (`…/auth/userinfo.email`) y `https://www.googleapis.com/auth/gmail.modify`, y guarda. `gmail.modify` deja leer, etiquetar, crear borradores y enviar, pero no borrar el correo para siempre.

Solo con «External», en **Branding**:

- En **App domain** (dominio de la app), pon la página de inicio (la web del negocio o la dirección de la app), la política de privacidad `https://tu-dominio/legal/privacidad` y las condiciones del servicio `https://tu-dominio/legal/terminos`. Google las pide a todas las apps externas en producción. Las dos páginas legales las sirve DominIA Agentes, son públicas y llevan los datos del negocio: ábrelas antes en el navegador.
- En **Authorized domains** (dominios autorizados), añade el dominio de la app (si la app está en `agentes.tunegocio.com`, basta con `tunegocio.com`) y el de cualquier otra dirección que pongas en esta página. Hazlo **antes** de crear el cliente del apartado siguiente: Google solo acepta direcciones de redirección de dominios autorizados.
- Mejor con **dominio propio**. Si la app solo tiene una dirección de Vercel (`….vercel.app`) y Google no la acepta como dominio autorizado, pon antes un dominio propio (guía «Publicar la app en Vercel»).
- **El logo no hace falta.** Si lo subes, Google revisa la marca antes de enseñarlo; mientras, la app funciona igual.

[Captura: Google Auth Platform › Audience con el tipo de usuario elegido]

[Captura: Google Auth Platform › Data Access con el permiso gmail.modify añadido]

## Credenciales

El **cliente OAuth** es lo que da el Client ID y el Client Secret que pide el asistente.

1. En el menú, **Google Auth Platform › Clients** (clientes) › **Create client** (crear cliente).
2. En **Application type** (tipo de aplicación), elige **Web application** (aplicación web) y ponle un nombre, por ejemplo «DominIA Agentes».
3. En **Authorized redirect URIs** (URIs de redirección autorizados), pulsa **Add URI** (añadir URI) y pega la dirección de redirección del asistente, exacta:

```
https://tu-dominio/api/oauth/google/callback
```

4. Para probar en local, añade también la que muestra el asistente en local (`http://localhost:3000/api/oauth/google/callback`). En «Authorized JavaScript origins» no hace falta nada.
5. Pulsa **Create** (crear). Google muestra el **Client ID**, que termina en `.apps.googleusercontent.com`, y el **Client Secret**.
6. **Copia el Client Secret en ese momento** (o descarga el archivo JSON): Google solo lo enseña al crearlo, y después solo deja ver sus cuatro últimos caracteres. Si lo pierdes, crea un secreto nuevo en el mismo cliente y cámbialo en DominIA Agentes.
7. Pega el Client ID y el Client Secret en el asistente.

- **La dirección tiene que coincidir letra a letra**: con `https`, el mismo dominio y sin barra al final. Google puede tardar desde 5 minutos hasta unas horas en aplicar un cambio.
- **No envíes el Client Secret** por email, WhatsApp ni chat. DominIA Agentes lo guarda cifrado y solo lo enseña como `••••1234`.
- Si más adelante cambias el Client ID, el asistente te pide otra vez el Client Secret y hay que volver a conectar el buzón.

[Captura: la creación del cliente «Web application» con la dirección de redirección añadida]

## Producción

Solo con **External**. Con Internal no hace falta publicar nada.

**Nunca dejes la app en «Testing»** (prueba): en ese estado Google corta el acceso a los **7 días** y el buzón pasaría a «Requiere reconexión» cada semana. Además, solo podrían conectar los usuarios de prueba.

1. En el menú, **Google Auth Platform › Audience** (público).
2. En **Publishing status** (estado de publicación), pulsa **Publish app** (publicar app) y confirma. El estado pasa a **In production** (en producción).
3. No envíes la app a verificación: no hace falta (lo explica la lista de aquí debajo).

Qué pasa al conectar el buzón:

- Google enseña un aviso de que no ha verificado la app. En español dice algo como «Google no ha verificado esta app»; en inglés, «Google hasn't verified this app». Es normal: la app es del propio negocio y solo la usan sus buzones.
- Comprueba que el nombre que sale es el de la app que creaste. Para seguir, pulsa **Advanced** (configuración avanzada) y después **Go to {nombre de la app} (unsafe)** (ir a {nombre de la app}, no seguro).
- Sin verificar, la app puede conectar como máximo **100 usuarios** nuevos en total. Un negocio conecta pocos buzones, así que sobra. Google considera de uso personal las apps con menos de 100 usuarios conocidos por quien las crea, y no les exige la verificación.
- Verificar la app no compensa: `gmail.modify` es un permiso restringido y su verificación exige una evaluación de seguridad externa.

Cuándo deja de valer el acceso (el canal pasa a «Requiere reconexión» y la app avisa al propietario y a los administradores):

- alguien lo retira desde la cuenta de Google;
- pasan **6 meses** sin que la app lo use (por ejemplo, con la app parada);
- cambia la contraseña de la cuenta;
- la misma cuenta se conecta más de **100 veces** con el mismo Client ID (las conexiones más antiguas dejan de valer);
- al conectar se dio acceso solo durante un tiempo, y ese tiempo pasa;
- un administrador de Google Workspace restringe el acceso;
- la app sigue en «Testing» (a los 7 días).

Para reconectar, pulsa **«Reconectar»** en el panel del canal y vuelve a «Conectar con Google» con la misma cuenta. No se pierde nada.

[Captura: Google Auth Platform › Audience con la app «In production»]

[Captura: el aviso de Google de app no verificada, con «Advanced» desplegado]

## Outlook

Para cuentas de **Outlook.com**, **Hotmail** o **Live** y para el correo de **Microsoft 365**. El negocio registra su propia app en Microsoft Entra (el antiguo Azure Active Directory), y DominIA Agentes la usa para leer el correo, dejar borradores y responder en la misma conversación.

Los buzones de Microsoft solo se conectan así: si en «Otro (IMAP/SMTP)» escribes una dirección o un servidor de Microsoft, la app te trae a esta opción. Microsoft ya no acepta la contraseña por IMAP y desactiva por defecto el envío por SMTP con contraseña a finales de 2026.

Qué caso es el tuyo:

- **Microsoft 365** (el correo de trabajo del negocio, normalmente con su dominio): la app se registra en el directorio (tenant) del negocio, solo para ese directorio, y en el asistente el **Tenant ID** es el del negocio.
- **Outlook.com, Hotmail o Live** (cuentas personales): la app admite cuentas personales y en el asistente el Tenant ID es `common`.

En orden:

1. **Entra**: registrar la app, con la dirección de redirección. Te da el Client ID y el Tenant ID.
2. **Permisos**: los permisos delegados de Microsoft Graph.
3. **Secreto**: el Client Secret y su fecha de caducidad.
4. **Consentimiento (admin)**: solo si Microsoft pide la aprobación de un administrador.
5. **El asistente de DominIA Agentes**, como se explica aquí debajo.

En DominIA Agentes:

1. Entra en **Canales › Añadir canal › Correo** y elige **Outlook / Microsoft 365**. Escribe un nombre para el canal.
2. Copia la **dirección de redirección** del asistente con su botón y pégala en Entra (apartado «Entra»). Es como esta: `https://tu-dominio/api/oauth/microsoft/callback`.
3. Pega el **Client ID** (el Application (client) ID), el **Client Secret** (su «Value»), la **fecha de caducidad del Client Secret** y el **Tenant ID** (`common` o el del negocio), y guárdalos.
4. Pulsa **«Conectar con Microsoft»**. Se abre Microsoft: entra con la **cuenta del buzón** y acepta los permisos.
5. Si Microsoft pide la aprobación de un administrador, el asistente enseña el enlace para darla (apartado «Consentimiento (admin)»).
6. Vuelves a DominIA Agentes, que comprueba los permisos concedidos y muestra la dirección conectada.
7. Elige el modo de respuesta, el agente, la IA, la firma y los topes diarios (apartado «Modo de respuesta y filtros»).

[Captura: el asistente de correo con Outlook elegido: Client ID, Client Secret, su caducidad, Tenant ID y «Conectar con Microsoft»]

## Entra

**Lo hace el negocio**, o quien implanta con una cuenta del directorio del negocio que tenga al menos el rol **Application Developer** (desarrollador de aplicaciones).

1. Entra en https://entra.microsoft.com con la cuenta de Microsoft del negocio. Si tu cuenta tiene varios directorios, cambia al del negocio con el icono **Settings** (configuración) de arriba.
2. Ve a **Entra ID › App registrations** (registros de aplicaciones) y pulsa **New registration** (nuevo registro).
3. En **Name** (nombre), escribe por ejemplo «DominIA Agentes».
4. En **Supported account types** (tipos de cuenta compatibles):

- Microsoft 365 del negocio: **Single tenant only** (solo este directorio).
- Outlook.com, Hotmail o Live: **Any Entra ID Tenant + Personal Microsoft accounts** (cualquier directorio y cuentas personales de Microsoft).

5. Pulsa **Register** (registrar).
6. En **Overview** (información general), copia el **Application (client) ID**: es el Client ID del asistente. Con Microsoft 365, copia también el **Directory (tenant) ID**: es el Tenant ID.
7. Añade la dirección de redirección: **Authentication** (autenticación) › **Add Redirect URI** (añadir URI de redirección) › **Web**, pega la dirección del asistente y pulsa **Configure** (configurar):

```
https://tu-dominio/api/oauth/microsoft/callback
```

- Tiene que coincidir letra a letra con la del asistente, y ser de tipo **Web**. Para probar en local, añade también la que muestra el asistente en local (`http://localhost:3000/api/oauth/microsoft/callback`).
- No copies el **Object ID** (id. de objeto): también es una cifra larga con guiones, pero el Client ID es el **Application (client) ID**.
- Si solo tienes una cuenta personal y Entra no te deja registrar apps, necesitas un directorio de Microsoft Entra propio (se crea, por ejemplo, al darte de alta en Azure con esa cuenta).

[Captura: App registrations › New registration con el tipo de cuenta elegido]

[Captura: Authentication con la dirección de redirección de tipo Web]

## Permisos

La app necesita cuatro **permisos delegados** de Microsoft Graph: actúa como la persona que conecta el buzón, y solo sobre ese buzón.

1. En la app, ve a **API permissions** (permisos de API) › **Add a permission** (agregar un permiso) › **Microsoft Graph** › **Delegated permissions** (permisos delegados).
2. Busca y marca `offline_access`, `Mail.ReadWrite` y `Mail.Send`. `User.Read` ya viene puesto al registrar la app.
3. Pulsa **Add permissions** (agregar permisos).

Para qué sirve cada uno:

- `Mail.ReadWrite`: leer el correo y crear los borradores de respuesta.
- `Mail.Send`: enviar las respuestas.
- `offline_access`: seguir conectado sin que la persona tenga que volver a entrar.
- `User.Read`: saber qué dirección tiene el buzón.

- No uses **Application permissions** (permisos de aplicación): darían acceso a todos los buzones de la organización.
- Ninguno de los cuatro necesita por sí mismo la aprobación de un administrador, pero la organización puede exigirla para cualquier app (apartado «Consentimiento (admin)»).

[Captura: API permissions con los cuatro permisos delegados de Microsoft Graph]

## Secreto

El **Client Secret** es la clave de la app. Microsoft lo hace caducar: **24 meses como máximo**, y recomienda menos de 12.

1. En la app, ve a **Certificates & secrets** (certificados y secretos) › **Client secrets** (secretos de cliente) › **New client secret** (nuevo secreto de cliente).
2. Escribe una descripción, por ejemplo «DominIA Agentes 2026».
3. En **Expires** (expira), elige la caducidad. Recomendado: **12 meses**. Anota la fecha en tu calendario.
4. Pulsa **Add** (agregar).
5. Copia la columna **Value** (valor), **no** la del **Secret ID** (id. de secreto). **Entra solo lo enseña ahora**: si sales de la página, tendrás que crear otro.
6. Pega el valor en el asistente y escribe la **fecha de caducidad** que enseña la columna **Expires**.

Qué pasa con la caducidad:

- **30 días antes**, la app avisa al propietario y a los administradores, y el panel del canal lo muestra: «El Client Secret caduca el … (en … días).»
- Cuando caduca, Microsoft rechaza el acceso (error **AADSTS7000222**) y el canal pasa a **«Requiere reconexión»** hasta que pongas uno nuevo.

Cómo renovarlo sin cortes:

1. Antes de que caduque, crea un secreto nuevo en **Certificates & secrets**. Se pueden tener dos a la vez.
2. En DominIA Agentes, en el canal, pega el nuevo Client Secret con su nueva fecha de caducidad y guarda. Si el canal ya estaba en «Requiere reconexión», pulsa **«Reconectar»**.
3. Cuando el canal funcione con el nuevo, borra el antiguo en Entra.

[Captura: Certificates & secrets con el secreto nuevo, su «Value» y su fecha en «Expires»]

## Consentimiento (admin)

Algunas organizaciones no dejan que sus empleados den permisos a una app por su cuenta: Microsoft pide entonces el consentimiento de un administrador (error **AADSTS65001**). La app lo dice así: «Microsoft pide el consentimiento de un administrador del tenant. Usa el enlace de consentimiento del administrador.»

Hay dos formas de darlo. Las hace un administrador del directorio del negocio (por ejemplo, con el rol de administrador global, de administrador de aplicaciones o de administrador de aplicaciones en la nube):

- **Con el enlace del asistente**: el asistente enseña el enlace de consentimiento del administrador. El administrador lo abre, entra con su cuenta, revisa los permisos y acepta, y vuelve a DominIA Agentes, que lo confirma. Después, pulsa otra vez **«Conectar con Microsoft»** con la cuenta del buzón.
- **Desde Entra**: en la app, **API permissions** › **Grant admin consent for {nombre del directorio}** (conceder consentimiento de administrador) › **Yes** (sí). En la columna **Status** (estado) sale «Granted for…» (concedido). Después, «Conectar con Microsoft».

- El enlace solo existe con el **Tenant ID del negocio**: con `common`, Microsoft no sabe a qué organización pedírselo. Si te hace falta, cambia en el asistente `common` por el Tenant ID del negocio.
- Las cuentas personales (Outlook.com, Hotmail o Live) nunca lo necesitan.

[Captura: API permissions con «Grant admin consent» y el estado «Granted»]

## IMAP

La opción **Otro (IMAP/SMTP)** vale para cualquier otro proveedor de correo: el hosting de tu dominio, Yahoo, iCloud, Zoho, GMX… La app lee el correo por **IMAP** y lo envía por **SMTP**, con la contraseña del buzón o con una contraseña de aplicación.

1. Entra en **Canales › Añadir canal › Correo** y elige **Otro (IMAP/SMTP)**. Escribe un nombre para el canal.
2. Escribe el **email** del buzón. La app rellena sola los servidores según el dominio (lista de aquí debajo). Si el dominio es del negocio, propone `mail.tudominio.com` y una lista de proveedores de hosting para elegir. Puedes cambiarlo todo.
3. Escribe el **usuario** (casi siempre, la dirección completa) y la **contraseña** (o la contraseña de aplicación, si tu proveedor la pide).
4. Revisa el **servidor IMAP** y el **servidor SMTP**, cada uno con su **puerto** y su **seguridad**.
5. Pulsa **«Probar conexión»**. Comprueba que puede entrar a leer (IMAP) y a enviar (SMTP) y, si algo falla, te dice qué en español. **Si falla, no se guarda nada** y el canal no queda conectado.
6. Cuando las dos partes funcionan, el buzón queda conectado y la app empieza a leerlo.

Seguridad y puertos:

- **SSL/TLS**: la conexión va cifrada desde el principio. Lo normal es el puerto **993** para IMAP y el **465** para SMTP.
- **STARTTLS**: la conexión se cifra después de conectar. Lo normal es el **587** para SMTP (y el 143 para IMAP).
- **Nunca el puerto 25**: la app no lo usa (y Vercel lo bloquea). Tampoco envía nunca una contraseña sin cifrar.
- Si cambias el servidor, el puerto, la seguridad o el usuario, hay que volver a escribir la contraseña: una contraseña guardada solo vuelve al servidor donde se guardó.
- «Probar conexión» se puede pulsar hasta 10 veces cada 10 minutos.

Las carpetas:

- La app reconoce las carpetas de **Enviados** y de **Borradores** por su función, no por su nombre, así que da igual el idioma del buzón.
- Guarda en Enviados una copia de lo que responde si el servidor no lo hace solo (Gmail sí lo hace).
- Al correo contestado le pone la palabra clave **IA-Respondido**, si el servidor lo permite.

Datos de cada proveedor. La app los rellena sola; si algo falla, compruébalos en la ayuda de tu proveedor:

- **Gmail** (gmail.com, googlemail.com): IMAP `imap.gmail.com`, 993, SSL/TLS · SMTP `smtp.gmail.com`, 465, SSL/TLS (o 587, STARTTLS). Contraseña de aplicación de 16 caracteres, con la verificación en dos pasos. Mejor la opción «Gmail».
- **Google Workspace**: los mismos servidores que Gmail. Desde el 14-03-2025 no funciona con la contraseña normal, solo con una contraseña de aplicación, si la organización lo permite. Mejor la opción «Gmail».
- **Yahoo Mail** (yahoo.com, yahoo.es, ymail.com, rocketmail.com): IMAP `imap.mail.yahoo.com`, 993, SSL/TLS · SMTP `smtp.mail.yahoo.com`, 465, SSL/TLS. Contraseña de aplicación.
- **iCloud Mail** (icloud.com, me.com, mac.com): IMAP `imap.mail.me.com`, 993, SSL/TLS · SMTP `smtp.mail.me.com`, 587, STARTTLS. Contraseña específica de app. En IMAP, el usuario es el nombre sin el dominio (si no funciona, la dirección completa); en SMTP, la dirección completa.
- **Zoho Mail** (zohomail.com): IMAP `imap.zoho.com`, 993, SSL/TLS · SMTP `smtp.zoho.com`, 465, SSL/TLS. IMAP solo está en los planes de pago (no en el gratuito de las cuentas nuevas) y hay que activarlo en Zoho Mail, en **Settings › Mail Accounts › IMAP Access**. Con verificación en dos pasos, contraseña específica de aplicación. Si tu cuenta está en otro centro de datos (por ejemplo, el europeo), el servidor cambia: míralo en los ajustes de Zoho.
- **Zoho Mail con dominio propio**: IMAP `imappro.zoho.com`, 993, SSL/TLS · SMTP `smtppro.zoho.com`, 465, SSL/TLS. Lo demás, como el anterior.
- **IONOS España**: IMAP `imap.ionos.es`, 993, SSL/TLS · SMTP `smtp.ionos.es`, 465, SSL/TLS. Contraseña del buzón.
- **IONOS** (.com): IMAP `imap.ionos.com`, 993, SSL/TLS · SMTP `smtp.ionos.com`, 465, SSL/TLS (o 587, STARTTLS). Contraseña del buzón.
- **Hostinger**: IMAP `imap.hostinger.com`, 993, SSL/TLS · SMTP `smtp.hostinger.com`, 465, SSL/TLS. Usuario: la dirección completa.
- **OVHcloud (MX Plan)**: IMAP `ssl0.ovh.net`, 993, SSL/TLS · SMTP `ssl0.ovh.net`, 465, SSL/TLS (también valen `imap.mail.ovh.net` y `smtp.mail.ovh.net`). Usuario: la dirección completa. Email Pro, Exchange y Zimbra de OVH usan otros servidores.
- **STRATO**: IMAP `imap.strato.de`, 993, SSL/TLS · SMTP `smtp.strato.de`, 465, SSL/TLS. No uses el 587: en STRATO es solo para servidores.
- **GMX** (gmx.net, gmx.de): IMAP `imap.gmx.net`, 993, SSL/TLS · SMTP `mail.gmx.net`, 587, STARTTLS. Activa POP3/IMAP en los ajustes de GMX.
- **GMX** (gmx.com, gmx.es): IMAP `imap.gmx.com`, 993, SSL/TLS · SMTP `mail.gmx.com`, 587, STARTTLS. Viene desactivado: actívalo en los ajustes de GMX.
- **cPanel u otro hosting con dominio propio**: IMAP `mail.tudominio.com`, 993, SSL/TLS · SMTP `mail.tudominio.com`, 465, SSL/TLS. Usuario: la dirección completa. Si el certificado del servidor no cubre tu dominio, cPanel indica en **Connect Devices** (conectar dispositivos) el nombre de servidor que hay que usar.
- **Outlook.com, Hotmail, Live y Microsoft 365**: no se conectan por aquí. Usa la opción **Outlook / Microsoft 365**.

[Captura: el asistente con «Otro (IMAP/SMTP)», los servidores rellenados y el resultado de «Probar conexión»]

## Contraseña de aplicación

Una **contraseña de aplicación** es una contraseña aparte que creas en la seguridad de tu cuenta de correo para un solo programa, en este caso DominIA Agentes. Tu contraseña de siempre no cambia, y la de aplicación se puede anular en cualquier momento sin tocar lo demás. Muchos proveedores la exigen para IMAP y SMTP.

- **Gmail**: necesita la **verificación en dos pasos** activada. Entra en https://myaccount.google.com/apppasswords, escribe un nombre (por ejemplo, «DominIA Agentes») y crea la contraseña de 16 caracteres. No sale si la cuenta solo usa llaves de seguridad, si tiene la Protección Avanzada o si es de una organización (trabajo o centro educativo): entonces usa la opción «Gmail». Google la anula si cambias la contraseña de la cuenta.
- **Google Workspace**: desde el 14-03-2025, IMAP y SMTP solo funcionan con contraseña de aplicación, y muchas organizaciones no las permiten. Mejor la opción «Gmail».
- **Yahoo**: en la página de seguridad de tu cuenta de Yahoo, en **External connections** (conexiones externas), pulsa **Create app password** (crear contraseña de aplicación), escribe un nombre y pulsa **Generate password** (generar contraseña). Hazlo desde un navegador con el que ya hayas entrado en Yahoo, no en una ventana privada.
- **iCloud**: necesita la autenticación de doble factor. Entra en https://account.apple.com, ve a **Sign-In and Security** (inicio de sesión y seguridad) › **App-Specific Passwords** (contraseñas específicas de app) y genera una.
- **Zoho**: con la verificación en dos pasos activada, crea una contraseña específica de aplicación en la seguridad de tu cuenta de Zoho.
- **Hosting con dominio propio** (IONOS, Hostinger, OVH, STRATO, cPanel…): normalmente, la contraseña del buzón. Si tu proveedor ofrece contraseñas de aplicación, mejor una.

- Trátala como una contraseña: pégala directamente en el asistente y no la envíes por email ni por chat. DominIA Agentes la guarda cifrada y solo la enseña como `••••1234`.
- Si la anulas o cambia la contraseña de la cuenta, el canal pasa a «Requiere reconexión»: crea otra, escríbela en el canal y pulsa «Probar conexión».

[Captura: la página de contraseñas de aplicación de la cuenta de correo, con una contraseña nueva para DominIA Agentes]

## Modo de respuesta y filtros

Esto se elige al final del asistente y se cambia cuando quieras en el canal (**Canales › el canal › Configuración**).

### Modo de respuesta

- **Borrador para revisar** (el de por defecto en el correo): la IA escribe la respuesta y la deja como borrador. En la **Bandeja** sale con **Aprobar**, **Editar** y **Descartar**, y en menos de un minuto aparece también en la carpeta de **Borradores** del buzón (en Gmail, dentro del mismo hilo). Al aprobarla, sale en el mismo hilo y el borrador del buzón desaparece. Si la descartas, también desaparece del buzón, como mucho en un minuto. Si alguien envía ese borrador desde el propio buzón, la app lo marca como enviado.
- **Automático**: la IA envía la respuesta directamente. En Gmail y en IMAP lleva la marca de respuesta automática, para que otros buzones no le contesten con su propia respuesta automática.

Recomendación: empieza con **Borrador para revisar** y pasa a **Automático** cuando te fíes de las respuestas del agente.

### Cómo sale la respuesta

- En el **mismo hilo**, con el mismo asunto («Re: …») y las cabeceras de respuesta, para que el cliente la vea dentro de su conversación.
- En Gmail, el correo contestado recibe la etiqueta **IA/Respondido** (dentro de «IA»); en IMAP, la palabra clave IA-Respondido.
- Con **saludo** y **firma**: la firma del canal (o el nombre del negocio, si no pones ninguna) y una línea con el aviso de IA: «Este correo lo ha escrito un asistente de inteligencia artificial.» o, si una persona revisó el borrador, «Este correo lo ha escrito un asistente de inteligencia artificial y lo ha revisado una persona.»
- Todo lo que envía la app lleva una marca propia: así nunca se contesta a sí misma.
- Solo a **quien envió el correo**. Si el correo pedía las respuestas en otra dirección («Responder a»), la app no la
  usa y lo dice en el hilo: esa dirección la escribe quien envía y podría ser la de otra persona.

### Remitente no verificado

La dirección del remitente la escribe quien envía el correo. Por eso la app mira lo que dice el servidor que lo recibió
(Gmail, Outlook y la mayoría de los servidores lo comprueban): si no confirma que el correo viene de esa dirección, la
Bandeja lo marca **«Remitente no verificado»** y, en esa respuesta, la IA no puede ver, cambiar ni cancelar citas ni
guardar datos del cliente: responde a lo general y ofrece que lo gestione una persona. Pasa lo mismo si en el hilo
escribe alguien distinto del cliente de la conversación (por ejemplo, alguien en copia). Con «Otro (IMAP/SMTP)», mira
en la Bandeja un correo que te hayan enviado desde fuera: si sale como no verificado aunque venga de un cliente real,
tu servidor de correo no está comprobando los remitentes; pregunta a tu proveedor antes de dar al agente de correo
herramientas de citas.

### Cuando responde una persona desde el buzón

Si alguien del equipo contesta al cliente desde su propio programa de correo (Gmail, Outlook, el del móvil…), la app lo ve, lo guarda en la conversación y **pausa la IA** en esa conversación con el motivo «Ha respondido una persona desde el buzón». La pausa dura lo que diga **Ajustes › Notificaciones › Pausa de la IA cuando responde una persona** (12 horas por defecto) y después la IA vuelve sola.

### Topes diarios

Para que una conversación no se alargue sin fin (por ejemplo, con otro programa que contesta solo), la IA tiene un tope de respuestas al día:

- **por hilo**: 5 por defecto;
- **por remitente**: 10 por defecto;
- **por buzón**: 200, sumando todos los hilos y remitentes (este no se cambia).

Los dos primeros los cambias en el canal. Se comprueban al llegar cada correo y otra vez justo antes de enviar la respuesta. Al llegar al tope, la IA deja de contestar ese día y la conversación espera a una persona, con el motivo «Tope diario de respuestas de la IA en este hilo», «Tope diario de respuestas de la IA a este remitente» o «Tope diario de respuestas de la IA en este buzón». El día se cuenta en la zona horaria del negocio.

### Qué correos se ignoran

La app no crea conversación ni responde a estos correos. **Ajustes › Diagnóstico** cuenta cuántos ha ignorado por cada motivo:

- **Respuestas automáticas**: fuera de la oficina, acuses de recibo automáticos y parecidos.
- **Envíos masivos**: correos marcados como envío en masa.
- **Listas y boletines con enlace de baja**: listas de correo y boletines (newsletters).
- **Remitentes «noreply»**: direcciones como `noreply@…` o `no-reply@…`, que no leen las respuestas.
- **Rebotes y avisos del servidor de correo**: avisos de correo no entregado (mailer-daemon, postmaster).
- **Enviados por el propio buzón**: correos que el buzón se envía a sí mismo (por ejemplo, si pruebas escribiéndote desde el mismo buzón).
- **Correos enviados por la app**: los que llevan la marca de DominIA Agentes.
- **Spam o correo no deseado**: el spam y la papelera de Gmail. En Outlook y en IMAP la app solo lee la bandeja de entrada, así que el correo no deseado ni lo ve.
- **Promociones (Gmail)**: la categoría «Promociones» de Gmail. Outlook no tiene esa categoría: su pestaña «Otros» mide la relevancia, y la app la lee igual.
- **Sin remitente**: correos sin dirección de remitente.

### Archivos y texto

- Antes de pasar un correo a la IA, la app lo convierte a texto, respeta sus acentos y caracteres, y quita las citas de los correos anteriores y las firmas. El original completo se guarda.
- Los **PDF** y las **imágenes** adjuntos van a la IA, y los **audios** se transcriben. Los demás archivos se guardan y se ven en la Bandeja.
- Los adjuntos demasiado grandes se guardan pero no van a la IA, y el mensaje lo indica. De cada correo se guardan como mucho 10 adjuntos, y los logotipos pequeños de las firmas se descartan.
- Un correo de más de 40 MB se guarda sin su contenido, con el aviso «Este correo es demasiado grande para leerlo aquí. Ábrelo en el buzón.»

## Prueba

Cuando el buzón esté conectado:

1. En el canal, elige el **agente activo** y enciende la IA (hace falta la clave de OpenRouter). Deja el modo **Borrador para revisar**.
2. Desde **otra dirección** (tu correo personal, por ejemplo), escribe al buzón conectado una pregunta sobre el negocio. No lo hagas desde el mismo buzón: se ignoraría.
3. En uno o dos minutos, la conversación aparece en la **Bandeja**, con el asunto, el hilo y el borrador de la IA. En el buzón, el borrador también sale en el hilo (Gmail) o en Borradores.
4. Pulsa **Aprobar**: la respuesta te llega en el mismo hilo, con la firma y el aviso de IA. En Gmail, el correo que enviaste queda con la etiqueta «IA/Respondido».
5. Contesta tú desde el buzón a ese mismo hilo: la conversación muestra tu respuesta y la IA queda en pausa.

Para probar el agente sin correos de verdad, usa **Ajustes › Diagnóstico › Simulador**: los mensajes simulados y sus respuestas nunca salen al buzón.

[Captura: la Bandeja con un hilo de correo y el borrador de la IA con Aprobar, Editar y Descartar]

## Después de conectar

- La app lee cada buzón **una vez por minuto**. En Vercel, eso depende del cron cada minuto (guía «Publicar la app en Vercel»).
- **Panel del canal** (Canales › el canal): semáforos de la conexión, los permisos, la última lectura y, en Outlook, la caducidad del Client Secret. Botones «Revalidar», «Pausar IA», «Desconectar» y, si hace falta, «Reconectar».
- **«Requiere reconexión»**: cuando el acceso caduca, se retira o cambia la contraseña, el canal deja de leer y de enviar, avisa una vez al propietario y a los administradores, y el panel dice el motivo. Al reconectar no se pierde nada: ni las conversaciones ni el punto por el que iba leyendo. Con Gmail u Outlook, pulsa «Reconectar» y vuelve a conectar con la misma cuenta; con IMAP, escribe la contraseña nueva y pulsa «Probar conexión».
- Si la lectura falla **3 veces seguidas** por otro motivo (por ejemplo, porque el servidor no responde), el canal pasa a «Error» con la explicación y avisa. Vuelve a «Conectado» en cuanto una lectura funciona.
- **Desconectar** deja de leer el buzón y borra el acceso guardado (en Google, además, lo retira). Las conversaciones se quedan. Para volver a conectarlo, escribe otra vez el Client Secret o la contraseña.
- **Varios buzones**: cada buzón es un canal, con su agente y sus ajustes. Los buzones del mismo negocio pueden usar el mismo proyecto de Google o la misma app de Entra.
- Los buzones de la demo nunca se conectan a Google, a Microsoft ni a un servidor de correo.

## Problemas

Estos son los problemas más frecuentes, con el mensaje que ves en la app, su causa y la solución.

### Al conectar con Google

- **«La API de Gmail no está activada en tu proyecto de Google Cloud. Actívala y vuelve a conectar.»** Causa: el proyecto del Client ID no tiene activada la Gmail API. Solución: actívala (apartado «Google Cloud») y pulsa otra vez «Conectar con Google».
- **«No se concedieron todos los permisos: leer y modificar el correo y ver el email de la cuenta. Vuelve a conectar y marca todas las casillas.»** Causa: en la pantalla de Google se quedó alguna casilla sin marcar. Solución: vuelve a conectar y márcalas todas.
- **«La cuenta no ha dado acceso sin conexión. Vuelve a conectar y acepta todos los permisos.»** Causa: Google no ha dado el acceso de larga duración que la app necesita para leer el buzón sola. Solución: vuelve a conectar y acéptalo todo; si se repite, retira el acceso de la app desde la seguridad de la cuenta de Google y conecta de nuevo.
- **Google enseña «Error 400: redirect_uri_mismatch».** Causa: la dirección de redirección del cliente no es exactamente la del asistente (`http` en vez de `https`, otro dominio, una barra de más) o Google aún no ha aplicado el cambio. Solución: cópiala de nuevo desde el asistente (apartado «Credenciales») y espera unos minutos.
- **Google dice que la app solo es para usuarios de prueba o que el acceso está bloqueado («Error 403: access_denied»).** Causa: la app sigue en «Testing» y la cuenta no es de prueba. Solución: publícala (apartado «Producción»).
- **Google dice que la app solo es para usuarios de su organización («Error 403: org_internal»).** Causa: la app es «Internal» y la cuenta es de fuera de la organización, por ejemplo una @gmail.com. Solución: conecta una cuenta de la organización, o cambia la app a «External» y publícala.
- **«El administrador de Google Workspace ha bloqueado el acceso de apps a Gmail.»** Causa: la organización limita qué apps pueden usar Gmail. Solución: que un administrador de Google Workspace marque la app como de confianza, con su Client ID, en los controles de acceso de apps de terceros de la consola de administración (API controls).
- **«No se ha podido leer el buzón con el acceso concedido. Vuelve a intentarlo.»** Causa: la cuenta con la que entraste no tiene Gmail, o hubo un fallo momentáneo. Solución: conecta con la cuenta del buzón y vuelve a intentarlo.

### Al conectar con Microsoft

- **«Microsoft pide el consentimiento de un administrador del tenant. Usa el enlace de consentimiento del administrador.»** Causa: la organización exige que un administrador apruebe la app (AADSTS65001). Solución: apartado «Consentimiento (admin)».
- **«El Client Secret no es correcto o ha caducado. Pon uno nuevo.»** Causa: se copió el «Secret ID» en vez del «Value», el secreto está mal copiado o ha caducado (AADSTS7000215 o AADSTS7000222). Solución: crea un secreto nuevo y copia su «Value» (apartado «Secreto»).
- **Microsoft dice que la dirección de respuesta no coincide con la de la app (AADSTS50011).** Causa: la dirección de redirección de Entra no es exactamente la del asistente, o no es de tipo «Web». Solución: añádela en **Authentication** como «Web», copiada del asistente (apartado «Entra»).
- **Microsoft dice que la cuenta no existe en el directorio o que la app no admite ese tipo de cuenta.** Causa: el tipo de cuenta de la app o el Tenant ID no encajan con el buzón, por ejemplo una cuenta de Outlook.com con una app «Single tenant only». Solución: con Outlook.com, Hotmail o Live, «Any Entra ID Tenant + Personal Microsoft accounts» y Tenant ID `common`; con Microsoft 365, «Single tenant only» y el Tenant ID del negocio (apartado «Entra»). Cámbialo en la app o regístrala de nuevo.
- **No aparece el enlace de consentimiento del administrador.** Causa: el Tenant ID del asistente es `common`. Solución: escribe el Tenant ID del negocio.
- **«Escribe «common» o el Tenant ID del negocio.»** Causa: lo escrito no es ni un identificador de directorio ni un dominio. Solución: copia el Directory (tenant) ID de **Overview**, o escribe `common`.
- **«Microsoft hace durar el Client Secret 24 meses como máximo.»** Causa: la fecha de caducidad escrita es más lejana. Solución: escribe la fecha exacta de la columna «Expires».
- **«El Client ID (Application ID) de Entra es un identificador como 00000000-0000-0000-0000-000000000000.»** Causa: lo pegado no es el Application (client) ID. Solución: cópialo de **Overview**. Ojo: el Object ID tiene la misma forma pero no vale.

### Al conectar con Google o Microsoft

- **«No se ha podido completar la conexión. Revisa el Client ID, el Client Secret y la dirección de redirección.»** Causa: el Client Secret no es el de ese Client ID o está mal copiado, o la dirección de redirección no coincide. Solución: cópialos de nuevo (apartados «Credenciales» o «Entra» y «Secreto»); si perdiste el secreto, crea otro.
- **«Se canceló el permiso en la pantalla de la cuenta. No se ha guardado nada.»** Causa: se pulsó «Cancelar» en la pantalla de Google o de Microsoft. Solución: vuelve a conectar y acepta.
- **«Esta vuelta no corresponde a ninguna conexión iniciada desde la app. No se ha guardado nada.»** Causa: se abrió de nuevo un enlace antiguo, se volvió atrás en el navegador o se terminó en otro navegador u otra sesión. Solución: pulsa otra vez «Conectar» desde el asistente, en el mismo navegador y con la misma sesión.
- **«La conexión ha tardado demasiado. Vuelve a pulsar «Conectar».»** Causa: pasaron más de 10 minutos entre pulsar «Conectar» y volver a la app. Solución: vuelve a pulsarlo y termina sin pausas.
- **«Tu sesión ha caducado. Entra de nuevo y vuelve a conectar el buzón.»** Causa: tu sesión de DominIA Agentes terminó mientras estabas en Google o en Microsoft. Solución: entra otra vez y repite la conexión.
- **«Faltan el Client ID o el Client Secret del canal.»** Causa: se pulsó «Conectar» sin haber guardado los dos. Solución: pégalos, guárdalos y vuelve a conectar.
- **«El proveedor de correo ha devuelto un error. No se ha guardado nada.»** Causa: Google o Microsoft devolvieron un error al volver a la app. Solución: vuelve a intentarlo; si se repite, revisa la configuración de la app en Google Cloud o en Entra con esta guía.

### Al probar la conexión (IMAP/SMTP)

- **«El usuario o la contraseña no son correctos. Si tu proveedor lo pide, usa una contraseña de aplicación.»** Causa: la contraseña está mal escrita, el proveedor exige contraseña de aplicación (Gmail, Yahoo, iCloud) o IMAP no está activado en la cuenta (Zoho, GMX). Solución: revisa el usuario y la contraseña, crea una contraseña de aplicación (apartado «Contraseña de aplicación») o activa IMAP en los ajustes del proveedor.
- **«No se encuentra el servidor. Revisa la dirección.»** o **«No se encuentra ese servidor. Revisa la dirección.»** Causa: el nombre del servidor está mal escrito o no existe. Solución: cópialo de la ayuda de tu proveedor (apartado «IMAP»).
- **«El servidor rechaza la conexión en ese puerto. Revisa el puerto y la seguridad.»** Causa: ese puerto no es el del servidor. Solución: 993 con SSL/TLS para IMAP; 465 con SSL/TLS o 587 con STARTTLS para SMTP.
- **«El servidor no responde. Revisa la dirección y el puerto.»** Causa: la dirección o el puerto están mal, o algo corta la conexión por el camino. Solución: revisa los dos; si están bien, prueba más tarde.
- **«No se puede establecer una conexión segura. Revisa la seguridad (SSL/TLS o STARTTLS) y que el certificado del servidor sea válido.»** Causa: la seguridad no casa con el puerto (por ejemplo, STARTTLS en el 465), o el certificado del servidor no es de ese nombre (pasa con `mail.tudominio.com` en algunos hostings). Solución: SSL/TLS en el 993 y el 465, STARTTLS en el 587; con cPanel, usa el nombre de servidor de «Connect Devices».
- **«Ese servidor está en una red privada. Usa la dirección pública de tu proveedor de correo.»** Causa: el nombre del servidor lleva a una dirección interna, no de internet. Solución: usa la dirección pública; si el servidor de correo es del propio negocio y solo existe en su red, habla con quien mantiene la app.
- **«Ese puerto no se puede usar. Usa el que indica tu proveedor (normalmente 993 para IMAP y 465 o 587 para SMTP; nunca el 25).»** o **«El puerto 25 no se puede usar: usa 465 o 587.»** Causa: se escribió el puerto 25 u otro que no se permite. Solución: pon el puerto que indica tu proveedor.
- **«Escribe solo el nombre del servidor, por ejemplo imap.tudominio.com.»** Causa: se escribió una dirección web (con `https://`), una ruta o espacios. Solución: escribe solo el nombre del servidor.
- **«Los buzones de Outlook y Microsoft 365 se conectan con la opción «Outlook / Microsoft 365»: Microsoft ya no admite IMAP con contraseña y desactiva el envío SMTP con contraseña a finales de 2026.»** Causa: la dirección o el servidor son de Microsoft. Solución: usa la opción Outlook / Microsoft 365 (apartado «Outlook»).
- **«Demasiadas pruebas de conexión seguidas. Espera unos minutos.»** Causa: más de 10 pruebas en 10 minutos. Solución: espera y revisa los datos antes de volver a probar.
- **El panel dice «No se ha encontrado la carpeta de enviados.»** Causa: el servidor no marca sus carpetas y no tiene ninguna con un nombre habitual («Sent», «Enviados»…). Solución: comprueba en el webmail que existe la carpeta de enviados. Mientras tanto, las respuestas salen igual, pero la app no guarda copia en Enviados ni ve lo que el equipo contesta desde otro programa.

### Con el buzón ya conectado

- **«Google ya no acepta el acceso: se revocó, caducó o cambió la contraseña. Vuelve a conectar el buzón.»** Causa: alguno de los motivos del apartado «Producción» (acceso retirado, contraseña cambiada, app en «Testing»…). Solución: pulsa «Reconectar» y conecta con la misma cuenta; si la app seguía en «Testing», publícala antes.
- **«Google no reconoce el Client ID o el Client Secret. Revísalos y vuelve a conectar el buzón.»** Causa: se borró el cliente o su secreto en Google Cloud, o se cambió el secreto. Solución: pon el Client Secret actual (o crea uno nuevo) y reconecta.
- **«Microsoft ya no acepta el acceso: se revocó, caducó por inactividad o cambió la contraseña. Vuelve a conectar el buzón.»** Causa: se retiró el permiso, un administrador restableció la contraseña o cerró las sesiones de la cuenta, o el acceso pasó mucho tiempo sin usarse. Solución: pulsa «Reconectar».
- **«El Client Secret de Microsoft ha caducado o no es correcto. Pon uno nuevo y vuelve a conectar.»** Causa: caducó el Client Secret (AADSTS7000222) o se borró en Entra. Solución: apartado «Secreto», «Cómo renovarlo sin cortes».
- **«Microsoft pide el consentimiento de un administrador para esta app. Pídeselo y vuelve a conectar.»** Causa: la organización ha empezado a exigir la aprobación de un administrador o ha retirado la que había. Solución: apartado «Consentimiento (admin)» y después «Reconectar».
- **«El servidor de correo ya no acepta el usuario o la contraseña (quizá ha cambiado). Vuelve a conectar el buzón.»** Causa: cambió la contraseña del buzón o se anuló la contraseña de aplicación. Solución: crea otra si hace falta, escríbela en el canal y pulsa «Probar conexión».
- **«Faltan las credenciales del buzón. Vuelve a conectarlo.»** o **«Faltan la contraseña o los servidores del buzón. Vuelve a conectarlo.»** Causa: el canal se desconectó o le faltan datos. Solución: pulsa «Reconectar» y completa el asistente.
- **«El Client Secret caduca el … (en … días).»** Causa: quedan menos de 30 días para que caduque el Client Secret de Microsoft. Solución: renuévalo ya (apartado «Secreto»).
- **«A la conexión con Gmail le falta un permiso. Vuelve a conectarla.»** o **«A la conexión con Microsoft le falta un permiso (Mail.ReadWrite o Mail.Send).»** Causa: no se concedieron todos los permisos, o falta alguno en la app de Entra. Solución: añádelo (apartado «Permisos») y reconecta marcando todas las casillas.
- **«Gmail limita las peticiones ahora mismo. Lo reintentamos.»** o **«Microsoft limita las peticiones ahora mismo. Lo reintentamos.»** Causa: se ha superado un límite del proveedor, por ejemplo el de envíos diarios (500 correos al día en una cuenta de Gmail, 2.000 en Google Workspace). Solución: ninguna, la app lo reintenta sola.
- **«Outlook solo admite aquí archivos de hasta 3 MB.»** Causa: se quiso enviar desde la Bandeja, por Outlook, un archivo de más de 3 MB. Solución: envía un archivo más pequeño o un enlace, o mándalo desde Outlook.

### No llegan los correos o la IA no contesta

- **No aparece nada en la Bandeja.** Causa: el trabajo en segundo plano no se está ejecutando (en Vercel, el cron cada minuto), el correo llegó antes de conectar el buzón o se ignoró por un filtro. Solución: revisa el cron (guía «Publicar la app en Vercel»), escribe un correo nuevo y mira en **Ajustes › Diagnóstico** los correos ignorados y su motivo.
- **Escribí desde el mismo buzón y no pasa nada.** Causa: los correos que el buzón se envía a sí mismo se ignoran («Enviados por el propio buzón»). Solución: escribe desde otra dirección.
- **El borrador no sale en el buzón.** Causa: el borrador del buzón se crea en la siguiente lectura. Solución: espera un minuto.
- **La IA no contesta.** Causa: el canal está en «Borrador para revisar» y el borrador espera en la Bandeja; la IA está en pausa porque respondió una persona (desde el buzón o desde la Bandeja); se llegó al tope diario; el canal no tiene agente activo o la IA está apagada; falta la clave de OpenRouter; el canal no responde fuera de horario; o el correo se ignoró. Solución: abre la conversación en la Bandeja (el motivo de la pausa sale junto al interruptor de la IA) y revisa el panel del canal.
