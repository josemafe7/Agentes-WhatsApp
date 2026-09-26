# 0014 · Construcción autónoma por fases, con agentes en paralelo

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

La plantilla pide que cada fase empiece con un plan que la persona aprueba (`AGENTS.md`, «Cómo trabajamos»),
que no se haga commit sin su permiso (`AGENTS.md`, «Reglas») y que el trabajo no se reparta entre subagentes:
«Para construir no repartas el trabajo entre subagentes: las fases comparten contexto y se construyen en esta
conversación» (`docs/review.md`, «Cómo se lanza»). DominIA Agentes es grande: ocho fases (de la 0 a la 7) y
varias integraciones externas. Había que decidir cómo se construye.

Decisión de la persona el 26-09-2026: la app se construye **de forma autónoma, fase a fase de la 0 a la 7, con
agentes en paralelo**. Cada fase se cierra con sus pruebas, una revisión independiente y un commit local en
`main`, sin subirlo a GitHub y sin crear otras ramas.

## Opciones consideradas

- **El proceso de la plantilla:** un plan aprobado por fase, una sola conversación que construye y permiso para
  cada commit.
- **Construcción autónoma con un solo agente:** sin esperas, pero lenta para el tamaño del producto.
- **Construcción autónoma con agentes en paralelo**, coordinados por un documento común y por un integrador en
  cada fase.

## Decisión

Construcción autónoma con agentes en paralelo, solo para esta construcción (fases 0 a 7):

- **Lo que se relaja:** las fases avanzan sin esperar a que la persona apruebe cada plan; el trabajo de una
  fase se reparte entre varios agentes, en contra de la regla de `docs/review.md` citada arriba; y el commit
  local en `main` al cerrar cada fase está aprobado de antemano.
- **Cómo se coordina:** un documento de encargo común para todos los agentes con las decisiones de
  arquitectura (0001 a 0013 y 0015), la organización del código y las reglas de reparto:
  - cada agente trabaja solo en los archivos de su tarea;
  - si necesita tocar un archivo compartido (esquema de datos, `package.json`, migraciones, componentes
    comunes), hace el cambio mínimo que añade sin romper y lo cuenta en su informe;
  - solo el integrador de la fase instala paquetes, genera migraciones (nunca dos agentes a la vez), compila y
    lanza Playwright.
- **Lo que no cambia:**
  - las pruebas se escriben antes que el código, a partir de `docs/spec.md`, y nunca se debilitan para que
    pasen;
  - al cerrar cada fase pasan lint, tipos, pruebas, pruebas de Playwright y compilación, se ejecuta
    `pnpm audit` y se repasa `docs/security.md`;
  - la revisión de `docs/review.md` la hace un agente que empieza de cero y no sabe qué se ha hecho;
  - todas las reglas de «Seguridad» de `AGENTS.md` y de `docs/security.md`. Instalar paquetes y aprobar
    excepciones (versiones dentro del margen de 7 días, scripts de instalación, exclusiones de confianza)
    sigue esas reglas: esta decisión no las cambia;
  - no se sube nada a GitHub, no se publica la app (0007) y los cambios en `AGENTS.md` se enseñan antes a la
    persona.

## Consecuencias

- Gana: la construcción avanza mucho más rápido, y cada fase queda en su propio commit, fácil de revisar y de
  deshacer.
- Acepta: más riesgo de que dos agentes hagan cosas incoherentes. Lo compensan el documento común, el
  integrador de cada fase, las decisiones escritas aquí y la revisión independiente.
- Acepta: la persona ve el resultado al cerrar cada fase, con la prueba de que funciona, en lugar de aprobar
  cada plan antes.
- Terminada la fase 7, el trabajo vuelve al proceso normal de la plantilla (plan aprobado, una conversación y
  permiso para cada commit) salvo que la persona decida otra cosa. `docs/review.md` no se cambia: esta
  decisión es la excepción documentada.
