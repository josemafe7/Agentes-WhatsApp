# 0001 · Una instalación por negocio (single-tenant)

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

DominIA Agentes se instala para negocios pequeños (una peluquería, una clínica dental, un restaurante…). Había
que decidir si una misma instalación atiende a muchos negocios (multi-cliente, con organizaciones o espacios
de trabajo) o si cada negocio tiene la suya. La elección condiciona todo lo demás: si cada tabla lleva un
identificador de negocio, cómo se comprueban los permisos, cómo se conectan WhatsApp, Gmail y Outlook, y cómo
se publica y se actualiza. El encargo (§1) pide una instalación por negocio, con su propia base de datos.

Datos comprobados el 26-09-2026 que pesan en la decisión:

- WhatsApp se conecta como «desarrollador directo»: la app de Meta está en el portfolio del propio negocio y
  usa un token permanente de usuario del sistema, sin App Review ni verificación de la empresa para empezar
  (`docs/integracion-whatsapp.md`, «Lo imprescindible» y §2).
- Una app de Meta tiene una sola URL de callback para sus webhooks (`docs/integracion-whatsapp.md`, §4.1): lo
  natural es una URL de webhook por instalación.
- Meta limita a 15 las apps por persona que no estén conectadas a una empresa verificada
  (`docs/integracion-whatsapp.md`, §8). Quien implanta no puede ser el dueño de las apps de muchos negocios:
  cada negocio debe tener y administrar la suya.
- Gmail: `gmail.modify` es un permiso restringido. Una app sin verificar funciona en producción con un aviso y
  un tope de 100 usuarios nuevos, y Google exime de verificación el uso personal de menos de 100 usuarios
  conocidos (`docs/integracion-correo.md`, §1.1). Eso encaja con un proyecto de Google Cloud por negocio, no
  con uno compartido entre negocios.
- Microsoft: con la app registrada en el tenant del propio negocio no aplica el bloqueo por «editor no
  verificado», que solo afecta a usuarios de otros tenants (`docs/integracion-correo.md`, §2.1).
- Dokploy permite varias instalaciones en el mismo servidor si el compose no publica puertos ni fija nombres
  de contenedor (`docs/plataforma-despliegue.md`, «docker-compose»).
- Next.js mete las variables `NEXT_PUBLIC_` en el código al compilar: una imagen compartida por varios negocios
  no puede llevar valores públicos propios de cada uno (`docs/plataforma-despliegue.md`, «docker-compose»).

## Opciones consideradas

- **Multi-cliente:** una sola instalación con organizaciones o espacios de trabajo y un identificador de
  negocio en cada tabla, en cada permiso y en cada webhook.
- **Una instalación por negocio:** cada negocio con su base de datos, sus archivos, sus claves y sus
  credenciales de Meta, Google y Microsoft.

## Decisión

Una instalación por negocio. No hay organizaciones, espacios de trabajo ni identificadores de negocio en las
tablas: los datos del negocio viven en una sola fila de `business_settings`. Cada instalación tiene su URL de
webhook de WhatsApp y su verify token, su proyecto de Google Cloud y su app de Microsoft Entra, y su clave de
cifrado (`APP_ENCRYPTION_KEY`). Es lo que pide el encargo y lo que permite conectar los canales sin entrar en
programas de partners de Meta (Tech Provider, Embedded Signup), que quedan fuera de alcance.

## Consecuencias

- Gana: el modelo de datos y los permisos son más simples, y no puede haber fugas de datos entre negocios
  porque no comparten base de datos. Cada negocio es dueño de sus apps y credenciales y puede revocarlas. Un
  fallo o una clave filtrada afecta a un solo negocio. Encaja con la exención de Google para uso personal y
  con el modelo de desarrollador directo de Meta.
- Acepta: cada negocio se publica y se actualiza por separado; por eso las migraciones son solo aditivas y en
  el futuro habrá versión (`APP_VERSION`), changelog y aviso de versión nueva. Quien implanta repite la
  configuración de Meta, Google y Microsoft en cada negocio, con las guías de `docs/` y las skills
  `nuevo-negocio`, `conectar-whatsapp` y `conectar-correo`. No hay un panel que muestre todos los negocios.
- Lo que cambia por instalación (URL pública, clave pública VAPID, nombre) se lee en el servidor en tiempo de
  ejecución, no en variables `NEXT_PUBLIC_`.
- Pasar a multi-cliente más adelante obligaría a añadir el identificador de negocio a todas las tablas, los
  permisos, los webhooks y los trabajos en segundo plano. El encargo lo pone en «No hacer».
