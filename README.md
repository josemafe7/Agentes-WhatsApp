# DominIA Agentes

Plataforma de agentes IA de atención al cliente (WhatsApp, correo y chat web) que se instala una vez por
negocio y se configura sin tocar código. Cada instalación es de un solo negocio, con su propia base de datos y
sus propias claves.

**Estado: fases 0 (base) y 1 (agentes y OpenRouter) construidas, solo en local.** Ya funcionan el arranque con
la demo, el inicio de sesión con roles e invitaciones, el asistente de arranque, los ajustes, el cifrado de
claves y los agentes de IA: crearlos desde la plantilla del sector, editarlos con versiones, elegir su modelo
de OpenRouter y probarlos en «Probar agente» viendo el coste y el tiempo de cada respuesta. Los canales, la
bandeja, la agenda y el conocimiento llegan en las fases siguientes (`docs/spec.md`, «Fases»). La app todavía no
está publicada en internet.

## Requisitos

- **Node.js 24 LTS** (`node -v` debe mostrar `v24.…`).
- **pnpm 10**. Viene con Node a través de Corepack: actívalo una vez con `corepack enable` y el proyecto usa
  solo la versión exacta que pide (`packageManager` en `package.json`). No uses npm ni yarn.
- **Git**, para clonar el repositorio.

No hace falta ninguna cuenta ni servidor: la base de datos es un archivo local.

## Arranque rápido

```bash
git clone <url-del-repositorio> dominia-agentes
cd dominia-agentes
corepack enable
pnpm install && pnpm dev
```

Abre <http://localhost:3000> y entra con uno de los usuarios de prueba.

La primera vez, `pnpm dev` prepara la instalación antes de arrancar: crea `.env.local` con secretos al azar
(clave de cifrado, secreto de las sesiones y secreto del cron) y la demo activada, crea `data/local.db`, aplica
las migraciones y carga la demo de una peluquería. Las siguientes veces arranca directamente. Mientras está en
marcha, lanza el trabajo en segundo plano cada 15 segundos.

¿Otro puerto? `pnpm dev -p 3200` (o `PORT=3200 pnpm dev`): las direcciones locales de la app se ajustan solas.

## Usuarios de prueba

Todos con la contraseña `demo1234`. Solo existen en la demo y se pueden borrar desde Ajustes › Usuarios.

| Email | Contraseña | Rol |
|---|---|---|
| `propietario@demo.test` | `demo1234` | Propietario |
| `admin@demo.test` | `demo1234` | Administrador |
| `supervisor@demo.test` | `demo1234` | Supervisor |
| `agente@demo.test` | `demo1234` | Agente |
| `lectura@demo.test` | `demo1234` | Solo lectura |

Cada rol ve en el menú solo lo que puede usar (la tabla completa está en `docs/spec.md`, «Quién puede hacer
qué»). Si escribes a mano la dirección de una página que tu rol no puede ver, la app responde «No tienes
permiso» sin enseñar nada.

## La clave de OpenRouter

La IA (los agentes, las transcripciones y la búsqueda por significado) necesita una clave de
[OpenRouter](https://openrouter.ai/settings/keys). Sin ella todo lo demás funciona y verás el aviso «Añade tu
clave de OpenRouter». Hay dos formas de ponerla:

1. **En la app (recomendado):** entra como propietario o administrador, ve a **Ajustes › IA**, pega la clave,
   pulsa «Probar clave» y guarda. Funciona al momento. Se guarda cifrada y la pantalla solo enseña `••••1234`.
2. **En `.env.local`:** añade `OPENROUTER_API_KEY=<tu clave>` y reinicia `pnpm dev`.

Si hay clave en los dos sitios, manda la de Ajustes. Antes de usar datos reales, revisa la privacidad de tu
cuenta de OpenRouter en <https://openrouter.ai/settings/privacy> (que los proveedores no guarden ni entrenen
con los datos); la app, además, lo prohíbe en cada petición.

Sin clave, la lista de modelos no se carga, los selectores de modelo y «Generar borrador con IA» están
desactivados y «Probar agente» no deja enviar: todos lo explican con el mismo aviso.

### Prueba a mano con una clave real

Las pruebas automáticas usan un OpenRouter simulado: nunca gastan. Para comprobar la fase 1 con OpenRouter de
verdad (gasta céntimos):

1. En <https://openrouter.ai/settings/keys> crea una clave nueva **con un límite de gasto pequeño** (por
   ejemplo, 1 US$) y comprueba que la cuenta tiene saldo. Revisa la privacidad de la cuenta (enlace de arriba).
2. Arranca la demo con `pnpm dev` y entra como `propietario@demo.test`.
3. **Ajustes › IA:** pega la clave, pulsa «Probar clave» (debe decir que es válida y enseñar el límite de
   gasto) y «Guardar cambios». La clave se ve solo como `••••` y sus 4 últimos caracteres, y el aviso «Añade
   tu clave de OpenRouter» desaparece.
4. **Agentes › Asistente de citas › Modelo:** abre «Modelo principal». Debe salir la lista real con
   «Recomendados» primero, el precio de entrada y de salida por millón de tokens en US$, el contexto y los
   iconos de imagen, PDF y audio, y abajo «Lista de tu cuenta de OpenRouter». Prueba «Actualizar lista» y el
   buscador.
5. **Probar:** escribe «Hola, ¿qué horario tenéis?». La respuesta debe usar el horario de Ajustes › Horario y,
   debajo, los tokens, el coste en US$ y el tiempo en ms. «Ver detalles» enseña el modelo y el proveedor que
   respondieron.
6. Cambia «Simular canal» a Correo y pregunta otra cosa: la respuesta llega con saludo y firma. Escribe
   «Quiero hablar con una persona»: se ve el traspaso simulado con el mensaje de la pestaña Traspaso.
7. Compara el coste con la actividad de tu cuenta en OpenRouter: debe coincidir con lo que muestra la app.
8. Vuelve a Ajustes › IA y pulsa «Quitar clave»: en Probar reaparece el aviso y no se puede enviar.

Si algo falla, el mensaje de la app explica el motivo en español (clave no válida, sin saldo, modelo no
disponible con tu privacidad…).

## Recorrido de la demo

Lo que ya puedes probar:

- **Entrar con cada rol** y ver cómo cambia el menú: Bandeja, Contactos, Agenda, Agentes, Conocimiento,
  Canales, Informes y Ajustes. En todas las pantallas aparece el aviso «Modo demo».
- **Ajustes › Negocio:** nombre, datos de contacto, sector, zona horaria, logo y color de la marca, con la
  vista previa en claro y oscuro. El color se aplica a todo el panel.
- **Ajustes › Usuarios:** invitar a alguien por email con su rol, cambiar roles, elegir los canales de un
  agente, desactivar, borrar, pasar la propiedad y exigir la verificación en dos pasos. Sin servidor de correo,
  la app te enseña el enlace de la invitación para copiarlo, y el correo queda guardado en `data/outbox/`.
- **Aceptar una invitación:** abre el enlace en otra ventana privada, pon nombre y contraseña, y entras con
  ese rol.
- **¿Has olvidado tu contraseña?** en la página de entrada: el correo con el enlace se guarda en
  `data/outbox/` al cabo de unos segundos (lo envía el trabajo en segundo plano).
- **Mi cuenta** (menú de tu usuario): nombre, contraseña, verificación en dos pasos con una app de
  autenticación y códigos de recuperación, tus avisos y cerrar sesión aquí o en los demás dispositivos.
- **Agentes:** la demo trae tres agentes, creados desde la plantilla de la peluquería: «Asistente de citas»
  (con dos versiones, para probar a restaurar), «Asistente de correo» y «Asistente fuera de horario», preparado
  sin activar. Crea uno con «Nuevo agente» (plantilla de tu sector, de otro sector, en blanco o «Generar
  borrador con IA» desde tu web o una descripción) y recorre su editor: General, Instrucciones (con «Vista
  previa del prompt»), Modelo, Conocimiento, Herramientas (solo «Pasar a una persona» por ahora), Traspaso,
  Canales, Probar y Versiones. Cada guardado crea una versión que se puede restaurar. Desde la tarjeta se
  duplica o se borra.
- **Probar agente** (pestaña Probar de un agente): un chat con el agente, sin canales reales, con «Simular
  canal» (WhatsApp, correo o chat web) y, en cada respuesta, los tokens, el coste en US$, el tiempo y «Ver
  detalles». Necesita la clave de OpenRouter (ver arriba); sin ella verás el aviso y no se puede enviar. El
  supervisor también puede probar; «Solo lectura» ve los agentes sin cambiar nada y el rol Agente no entra.
- **Ayuda** (menú de tu usuario, o Ajustes › Acerca de): las guías paso a paso dentro de la app: crear y probar
  agentes, y publicar en Vercel. Las demás llegan con sus fases.
- **Ajustes › Horario, IA, Correo del sistema, Privacidad y legal y Notificaciones:** horario con varios tramos
  por día y festivos; la clave de OpenRouter, los modelos por defecto (chat, respaldo de otro proveedor,
  transcripción, embeddings y descripción de imágenes) elegidos de la lista con precios, la lista de
  recomendados y «Sin retención de datos», con aviso si un modelo en uso se retira o si el de transcripción tiene
  proveedores que pueden guardar los audios; el servidor SMTP de los
  correos de la app; textos legales, aviso de IA y plazos de conservación; y quién recibe cada aviso.
- **Ajustes › Registro de actividad y Diagnóstico:** quién hizo qué, con filtros; y el estado de la base de
  datos, de la cola de trabajos (con «Reintentar») y de los correos que ha enviado la app, que en local puedes
  abrir desde ahí.
- **Páginas legales públicas**, sin iniciar sesión: `/legal/privacidad`, `/legal/terminos` y
  `/legal/eliminacion-datos`.
- **Asistente de arranque:** con `pnpm db:fresh` (ver «Paso a un negocio real») la app queda vacía y te guía:
  cuenta de propietario, negocio y sector, horario, clave de IA, primer agente (desde la plantilla del sector
  o generado desde la web del negocio si hay clave) y canales.

Próximamente: el simulador de canales, `/widget-demo` con el chat web, la bandeja con traspaso a una persona,
los agentes asignados a canales, la agenda con citas y el conocimiento con sus documentos (fases 2 a 5).

## Órdenes

| Orden | Qué hace |
|---|---|
| `pnpm dev` | Arranca la app en local (y la prepara si falta `.env.local` o la base de datos). |
| `pnpm run setup` | Solo la preparación. Siempre con `run`: `pnpm setup` es otra orden de pnpm que cambia el PATH del ordenador. Repetirla no cambia nada. |
| `pnpm lint` / `pnpm typecheck` | Revisan el código y los tipos. |
| `pnpm test` | Pruebas de Vitest (cada archivo con su propia base temporal; nunca toca `data/local.db`). |
| `pnpm test:e2e` | Pruebas de Playwright: compila la app, la arranca en los puertos 3100 (demo) y 3102 (instalación vacía) con sus propias bases (`data/e2e.db` y `data/e2e-fresh.db`) y simula los servicios externos en el 3101. La primera vez: `pnpm exec playwright install chromium`. |
| `pnpm build` / `pnpm start` | Compila la app como en producción y la arranca. |
| `pnpm db:migrate` | Pone la base de datos al día (migraciones). |
| `pnpm db:generate` | Genera una migración nueva a partir del esquema (solo para desarrollar). |
| `pnpm seed [--sector=…]` | Carga la demo de un sector en lugar de la que haya: `peluqueria` (por defecto), `clinica-dental`, `fisioterapia`, `restaurante`, `taller`, `academia`, `inmobiliaria`, `tienda` u `otro`. Se niega si la base tiene datos de un negocio real, o si `DEMO_MODE` no es `true` (salvo con `--force-demo`). |
| `pnpm seed:embeddings` | Recalcula los embeddings de la demo (llega con la fase de conocimiento). |
| `pnpm db:reset [--sector=…]` | Borra todo y deja la demo como recién instalada. Pregunta antes (`--yes` para no preguntar). |
| `pnpm db:fresh` | Borra todo y deja una instalación vacía con el asistente de arranque. Pregunta antes (`--yes`). |
| `pnpm worker` | Ejecuta el trabajo en segundo plano en bucle, para un servidor propio (VPS). |

`db:reset` y `db:fresh` borran datos: para antes la app, y nunca los uses con datos reales. Con una base que no
es un archivo local se niegan salvo con `--remote-i-know`.

## Variables de entorno

Están todas explicadas en `.env.example`. En local no tienes que tocar ninguna: `pnpm dev` crea `.env.local`.

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Base de datos: `file:./data/local.db` en local; la URL de Turso al publicar. |
| `DATABASE_AUTH_TOKEN` | Token de Turso (vacío en local). |
| `APP_URL`, `BETTER_AUTH_URL` | Dirección de la app, para los enlaces de los correos y el inicio de sesión. |
| `BETTER_AUTH_SECRET` | Firma las sesiones. |
| `APP_ENCRYPTION_KEY` | Cifra las claves que el negocio pone en la app. **Guárdala aparte:** si se pierde, esas claves no se pueden leer. Sin ella la app no arranca. |
| `CRON_SECRET` | Protege la ruta del trabajo en segundo plano (`/api/cron/tick`). |
| `SETUP_TOKEN` | Código de instalación: en una instalación publicada, el primer paso del asistente lo pide para crear el propietario. En local, vacío. |
| `DEMO_MODE` | `true` en local: aviso «Modo demo» y canales de demo que nunca llaman a servicios reales. |
| `OPENROUTER_API_KEY` | Clave de OpenRouter (opcional; mejor en Ajustes › IA). |
| `BLOB_READ_WRITE_TOKEN` | Almacén de archivos de Vercel Blob al publicar; en local los archivos van a `data/uploads/`. |
| `OPENROUTER_BASE_URL` y demás `*_BASE_URL` | Solo para las pruebas, que apuntan a un simulador. No las cambies. |

Los secretos van solo en `.env.local`, que nunca se sube a Git.

## Conectar canales reales

Llega con las fases de canales. Mientras tanto, lo comprobado de cada servicio está en:

- WhatsApp (API oficial de Meta): `docs/integracion-whatsapp.md` y `docs/integracion-whatsapp-mensajes.md`.
  Guía paso a paso: `docs/guia-whatsapp.md` (próximamente).
- Gmail, Outlook e IMAP/SMTP: `docs/integracion-correo.md`. Guía: `docs/guia-correo.md` (próximamente).
- El correo de la propia app (invitaciones y recuperación de contraseña) ya se configura en Ajustes › Correo
  del sistema, con los datos SMTP de tu proveedor.

## Despliegue

La app todavía no está publicada: de momento funciona solo en local. Cuando toque, la guía paso a paso es
[`docs/guia-despliegue.md`](docs/guia-despliegue.md) (también dentro de la app, en Ayuda): Vercel con Turso (base
de datos), Vercel Blob privado (archivos), el código de instalación (`SETUP_TOKEN`) y un cron externo cada minuto,
porque el plan gratuito de Vercel solo admite uno al día. `vercel.json` ya trae ese cron diario a `/api/cron/tick`
y la región de las funciones en la UE. Los datos técnicos de cada servicio están en
`docs/plataforma-despliegue.md`.

## Paso a un negocio real

1. Para la app y ejecuta `pnpm db:fresh`: borra la demo y deja la instalación vacía.
2. En `.env.local`, cambia `DEMO_MODE=true` por `DEMO_MODE=false` y arranca con `pnpm dev`.
3. Abre la app: el asistente de arranque te pide la cuenta de propietario, el negocio y su sector, el horario y
   la clave de OpenRouter.
4. Guarda `APP_ENCRYPTION_KEY` en un gestor de contraseñas.

A partir de aquí `pnpm seed` se niega a cargar la demo en esa base, para no mezclarla con datos reales.

## Solución de problemas

- **`pnpm: command not found` o una versión de pnpm distinta:** ejecuta `corepack enable` y abre otra terminal.
- **Escribí `pnpm setup` y cambió el PATH:** era la orden de pnpm, no la del proyecto. La del proyecto es
  `pnpm run setup`.
- **El puerto 3000 está ocupado:** `pnpm dev -p 3200`.
- **Después de actualizar el proyecto falla la base de datos:** `pnpm db:migrate` (o `pnpm run setup`), que
  aplica las migraciones nuevas sin borrar nada.
- **«La base de datos está en uso» al usar `db:reset` o `db:fresh`:** para antes `pnpm dev` y `pnpm worker`.
- **«APP_ENCRYPTION_KEY falta o no es válida» y la app no arranca:** falta la clave en `.env.local`. En local,
  `pnpm run setup` la crea; si la tenías y la has perdido, las claves guardadas en la app hay que volver a
  escribirlas.
- **«Demasiados intentos. Espera unos minutos.»:** tras 5 contraseñas mal seguidas, espera 15 minutos.
- **No llegan las invitaciones ni los enlaces de recuperación:** sin servidor de correo se guardan en
  `data/outbox/` (y se ven en Ajustes › Diagnóstico). Para enviarlos de verdad, configura Ajustes › Correo del
  sistema.
- **Windows y rutas largas:** clona el proyecto en una ruta corta (por ejemplo `C:\proyectos\dominia-agentes`).
  Con rutas de más de 260 caracteres las herramientas no encuentran sus programas.
- **El asistente pide un «código de instalación» o dice que falta:** pasa en una instalación publicada (o con
  `pnpm build` y `pnpm start`). Es el valor de `SETUP_TOKEN`; si no existe, créalo como explica
  `docs/guia-despliegue.md`. Con `pnpm dev` no se pide.
- **Quiero empezar la demo de cero:** `pnpm db:reset` (o `pnpm seed --sector=…` para otro sector).
- **«Añade tu clave de OpenRouter» aunque la he puesto en `.env.local`:** reinicia `pnpm dev`; la de Ajustes › IA
  funciona al momento.
- **El agente no responde en Probar:** el mensaje dice por qué. Lo habitual: clave no válida o caducada, cuenta
  sin saldo o clave en su límite de gasto (se sube en OpenRouter), o «Este modelo no está disponible con tu
  configuración de privacidad» (elige otro modelo en la pestaña Modelo o revisa la privacidad de la cuenta).
- **La lista de modelos no sale o le falta alguno:** sin clave no se carga. Solo aparecen modelos que admiten
  herramientas, con precio y sin fecha de retirada; «Actualizar lista» la vuelve a pedir a OpenRouter (se guarda
  12 horas).

## Cómo se trabaja en este proyecto

Se construye por fases con un agente de código. Lo que el agente cumple sin que se lo pidan está en
`AGENTS.md` y en `docs/`. Esto es lo que se le pide en cada momento:

| Cuándo | Qué se le pide |
|---|---|
| Para decidir el aspecto, antes de la primera fase con pantallas | «Vamos con el diseño. Sigue docs/design.md.» |
| Al volver con el diseño hecho fuera | «Ya he dejado el diseño en docs/design/. Léelo y dime qué has entendido.» |
| Al empezar cada fase, en una conversación nueva | «Vamos con la fase 1 de docs/spec.md. Propón un plan.» |
| Si algo no funciona | Lo que se ve y lo que se esperaba: «Al pulsar Guardar no pasa nada; esperaba ver el contacto en la lista.» |
| Al acabar una fase | «Cierra la fase 1.» |
| Para un retoque: un texto, un color, un botón que se mueve | Se pide tal cual, sin más: «Cambia el título de la portada por…» |
| Para añadir o cambiar algo | «Quiero que la app también…» o «Quiero que esto funcione de otra forma»: primero cambia la especificación y después se construye |
| Para que el agente cumpla algo siempre | «Añade a las reglas de AGENTS.md: …» |
| Para que otro revise una fase, en una conversación nueva | «Revisa la fase 1 siguiendo docs/review.md. No cambies nada.» |
| Antes de publicar, en una conversación nueva | «Revisa el proyecto contra docs/security.md.» |
| Para publicar la app o una versión nueva | «Quiero publicar la app.» |
| Cada mes o dos, con la app publicada | «Haz el mantenimiento.» |

## Documentación

Todo lo demás está en `docs/`, con su índice en `docs/README.md`: la especificación (`docs/spec.md`), la
arquitectura (`docs/architecture.md`), la seguridad (`docs/security.md`), las pruebas (`docs/testing.md`) y los
datos comprobados de cada servicio externo (`docs/integracion-*.md`).

Guías para el negocio (también dentro de la app, en Ayuda):

- [Crear agentes y darles el conocimiento del negocio](docs/guia-agentes-y-conocimiento.md): crear, ajustar y
  probar un agente (la parte de conocimiento llega con su fase).
- [Publicar la app en Vercel](docs/guia-despliegue.md).
