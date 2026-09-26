# 0015 · Diseño propio, recogido en `DESIGN.md`

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

`docs/design.md` ofrece tres caminos para decidir el aspecto de la app: diseñarla fuera en una herramienta de
diseño, que la diseñe el agente a partir de unas pocas preguntas, o usar los componentes tal como vienen. La app
la usa el equipo de un negocio pequeño, en ordenador y, sobre todo la bandeja, en el móvil; y cada negocio pone
su color y su logo.

Decisión de la persona el 26-09-2026: **la diseñamos nosotros** (camino 2), con un aspecto sobrio y
profesional, ordenador y bandeja en el móvil como app instalada (PWA), tema claro y oscuro, color y logo del
negocio configurables y, por defecto, el azul DominIA `#3d6df2`.

Datos comprobados el 26-09-2026:

- El azul `#3d6df2` con texto blanco da un contraste de 4,499:1, a una milésima del mínimo de WCAG AA (4,5:1).
  Oscureciéndolo lo justo (`#3c6cf1`) llega a 4,56:1 sin que se note (`DESIGN.md`, «Color del negocio»).
- El color de cada negocio puede ser cualquiera (un amarillo, un marino), así que el contraste no se puede
  garantizar eligiendo un color a mano: hay que calcularlo (`DESIGN.md`, «Color del negocio»).
- El gris de serie de shadcn/ui no llega a los contrastes de WCAG 2.2 AA en el texto secundario ni en el borde
  de los campos (1,27:1 frente al 3:1 que pide un borde de campo), y `DESIGN.md` los ajusta («Base neutra»).
- Los avisos push en iPhone y iPad necesitan iOS o iPadOS 16.4 o posterior y la app añadida a la pantalla de
  inicio (`docs/notificaciones-push.md`, «Dónde funciona»).
- En shadcn/ui con el estilo previsto para la fase 0 (`radix-nova`), el componente `form` está vacío y se usa
  `field`; `drawer` depende de `vaul`, que su autor declara sin mantenimiento, y se sustituye por `sheet`
  desde abajo (https://ui.shadcn.com/r/styles/radix-nova/form.json; https://github.com/emilkowalski/vaul).
- El manifiesto de la PWA (`app/manifest.ts`) se guarda en caché por defecto; como el nombre, el color y el
  logo salen de la base de datos, tiene que ser dinámico
  (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest).

## Opciones consideradas

- **Diseñarla fuera** en una herramienta de diseño y aplicar lo que exporte.
- **Diseñarla nosotros** y dejar sus reglas en `DESIGN.md`.
- **Aspecto por defecto** de los componentes, sin diseño propio.

## Decisión

Diseño propio, con sus reglas en `DESIGN.md` en la raíz del proyecto y las pantallas en `docs/pantallas.md`:

- base neutra (gris zinc ajustado para contraste) y el color del negocio solo en la acción principal, la
  selección y el foco; colores semánticos solo para estados;
- el color del negocio se guarda una vez en `business_settings` y una función pura, con pruebas, calcula las
  variantes de cada tema para cumplir los contrastes; si hace falta retocarlo, Ajustes lo explica;
- tema claro por defecto y oscuro opcional (Claro, Oscuro o Sistema), recordado por dispositivo;
- el tema se aplica una sola vez, con las variables de shadcn/ui en los estilos globales, y todas las pantallas
  lo usan; una sola familia de iconos (lucide) y textos en español;
- propietario, administrador y supervisor, pensados para ordenador; los agentes, también en el móvil con la app
  instalada, sobre todo la bandeja.

## Consecuencias

- Gana: un aspecto coherente sin depender de una herramienta externa, accesible con cualquier color de marca y
  fácil de cambiar en un solo sitio.
- Acepta: no hay maquetas previas: la persona ve el aspecto al cerrar cada fase con pantallas.
- Acepta: el color que elige el negocio puede verse un poco más oscuro o más claro para que se lea bien.
- Cambiar el diseño es cambiar `DESIGN.md` y el tema, nunca pantalla a pantalla (`docs/design.md`).
