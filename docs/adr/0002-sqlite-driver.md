# ADR-0002: Driver SQLite — `node:sqlite` vs `better-sqlite3`

**Estado:** Aceptado (decisión de driver, corregida el 2026-09-25 tras encontrar un hueco de verificación); implementación diferida a una fase posterior
**Fecha:** 2026-09-24 (corrección: 2026-09-25)
**Fase:** F1 (Architecture)

> **Corrección del 2026-09-25:** la verificación original de este ADR solo
> probó `node:sqlite` en Node v24.12.0 (la versión instalada en esta
> máquina), no en el piso mínimo real que fija `package.json`
> (`>=22.19.0`). Esa es una verificación insuficiente para una decisión que
> debe sostenerse en cualquier máquina que cumpla el mínimo declarado, no
> solo en la mía. Corregido abajo con evidencia contra fuentes oficiales de
> Node, con criterio de despliegue en VPS (no de esta máquina de
> desarrollo).

## Contexto

PROMPT_MASTER_CLAUDE_CODE.md §8 pide SQLite en modo WAL, `busy_timeout`,
`foreign_keys=ON`, con migraciones SQL versionadas y tabla
`schema_migrations`, y plantea explícitamente la disyuntiva como "ADR de la
Fase 1": `node:sqlite` (verificar disponibilidad/estabilidad en la versión
de Node fijada, ≥ 22.19, y bajo Bun si el runtime lo usa) vs
`better-sqlite3` (nativo: requiere añadirse a `allowBuilds` en
`pnpm-workspace.yaml`).

**Verificación original (Fase 1, insuficiente):** en esta máquina (Windows
11, Node v24.12.0), `node -e "new (require('node:sqlite')).DatabaseSync(':memory:')"`
funciona, con `ExperimentalWarning: SQLite is an experimental feature and
might change at any time`. Cierto, pero no responde la pregunta real: ¿qué
pasa en Node v22.19.0, el piso que el repo promete soportar, y qué versión
de Node debería correr realmente el VPS de producción?

**Verificación corregida (2026-09-25), contra el doc oficial de Node
(`doc/api/sqlite.md`, leído directo del repo `nodejs/node` en los tags
correspondientes):**

| Node | Estado real de `node:sqlite` | Fuente |
|---|---|---|
| v22.5.0 | Introducido, detrás de `--experimental-sqlite` | `nodejs/node` doc, YAML `added: v22.5.0` |
| **v22.13.0** | Flag `--experimental-sqlite` **eliminado** — ya no hace falta pasarlo, pero sigue "still experimental" | PR nodejs/node#55890, backporteado a v22.13.0 |
| **v22.19.0 (el piso exacto que fija `package.json`)** | Sin flag (heredado de v22.13.0). Estabilidad: **`1.1 - Active development`** — confirmado leyendo `doc/api/sqlite.md` en el tag `v22.19.0` exacto | `raw.githubusercontent.com/nodejs/node/v22.19.0/doc/api/sqlite.md` |
| v22.x más reciente (rama `v22.x-staging`, hoy) | Sigue en **`1.1 - Active development`** — nunca fue promovido más allá en la línea v22 | `raw.githubusercontent.com/nodejs/node/v22.x-staging/doc/api/sqlite.md` |
| v23.4.0 | Mismo cambio de flag que v22.13.0 (ambas versiones en el mismo PR) | igual que arriba |
| **v24.15.0** | Promovido a **`1.2 - Release candidate`** — un escalón de madurez más que v22.x | `doc/api/sqlite.md`, YAML `changes` |
| v25.7.0 | Mismo `1.2 - Release candidate` | igual que arriba |

**Conclusión de la verificación:** el hueco original no era sobre el flag
(`--experimental-sqlite` **no** hace falta en `>=22.19.0`, confirmado — la
preocupación original estaba mal dirigida). El hueco real es de
**estabilidad**: en el piso mínimo que fija el repo (Node 22.19.0, y toda
la línea v22 hasta hoy), `node:sqlite` se queda permanentemente en
`1.1 - Active development` — nunca alcanzó `1.2 - Release candidate`
salvo en v24.15.0+/v25.7.0+.

**Criterio de VPS, no de esta máquina** (calendario de soporte,
`raw.githubusercontent.com/nodejs/Release/main/schedule.json`, leído
2026-09-25):

| Línea | LTS activa hasta | Mantenimiento hasta EOL | `node:sqlite` |
|---|---|---|---|
| v22 "Jod" | 2025-10-21 (**ya en Mantenimiento** a fecha de hoy) | 2027-04-30 | `1.1` (no mejora más en esta línea) |
| **v24 "Krypton"** | **2026-10-20 (Activa hoy)** | 2028-04-30 | `1.2` desde v24.15.0 |
| v25 | nunca fue LTS; Mantenimiento desde 2026-04-01 | 2026-06-01 (**ya vencida o por vencer**) | `1.2`, pero la línea no sirve para producción de todos modos |

v22 ya pasó a Mantenimiento (solo backports críticos, sin nuevas mejoras de
estabilidad) y v25 nunca fue una línea de soporte largo — ninguna de las
dos es la elección correcta para un VPS que va a correr 24/7 durante los
~10 meses de fases de este proyecto y más. v24 es hoy la línea Activa LTS
con el runway más largo (hasta 2028-04-30) y es, además, la única línea
donde `node:sqlite` llegó a "Release candidate".

`better-sqlite3`: sigue **NO ENCONTRADO EN EL REPOSITORIO** — no es
dependencia de ningún paquete hoy, y tampoco está en `allowBuilds` de
`pnpm-workspace.yaml` (la lista actual es `bufferutil, ccxt, dugite,
electron, electron-winstaller, esbuild, msw, node-pty, protobufjs`).

Nota sobre Bun: `package.json` declara Bun 1.4.0 como runtime alternativo
de distribución (`.bun-version`, `#openalice/pty-backend`, documento de
referencia §2.1, [DOCUMENTACIÓN]). Sigue sin verificarse si `node:sqlite`
funciona bajo el modo de compatibilidad Node de Bun — la decisión de abajo
no depende de esto porque fija Node puro para `services/engine`, no Bun.

## Opciones consideradas

### Opción A — `better-sqlite3`

- Ventajas: API síncrona madura, ampliamente usada en producción, sin
  advertencia experimental.
- Desventajas: módulo **nativo** (requiere compilación con node-gyp o
  prebuilds por plataforma/arquitectura). Necesitaría añadirse
  explícitamente a `allowBuilds` en `pnpm-workspace.yaml` — un cambio a un
  archivo raíz compartido por todo el monorepo, fuera del directorio
  `services/engine/` que esta Fase 1 debía tocar únicamente. Añade una
  dependencia nativa más al ya existente conjunto (`node-pty`, `dugite`,
  `electron`) que la Fase 0 confirmó que compila sin problemas en esta
  máquina Windows — pero cada dependencia nativa adicional es una
  superficie más de fallo de build por plataforma (precisamente lo que la
  Fase 0 tuvo que verificar para las tres existentes).

### Opción B — `node:sqlite` — **elegida**

- Ventajas: cero dependencias nuevas, cero cambios a `allowBuilds` ni a
  ningún archivo raíz compartido, disponible ya en el Node fijado por el
  repo (confirmado arriba). Consistente con la preferencia general del
  ecosistema Node reciente de mover funcionalidad común al core.
- Desventajas: **experimental** — la propia advertencia de Node lo dice
  ("might change at any time"). Su API síncrona (`DatabaseSync`) es más
  nueva y con menos millas recorridas en producción que `better-sqlite3`.
  Compatibilidad con Bun no verificada.

## Decisión

Usar **`node:sqlite`** cuando `services/db` se implemente (fase posterior,
no esta Fase 1) — misma elección que antes, pero ahora con una condición
explícita que la corrección de hoy hace necesaria:

**`services/engine/package.json` fija su propio piso de Node,
`"engines": { "node": ">=24.15.0" }` — más estricto que el `>=22.19.0` de
la raíz del monorepo.** Esto es una divergencia deliberada respecto al
resto de OpenAlice (Alice/UTA/Connector siguen en `>=22.19.0`), aplicada
en esta corrección (commit de esta misma sesión). Motivo: es la única
forma de garantizar que `node:sqlite` corra en `1.2 - Release candidate`
en vez de quedarse indefinidamente en `1.1 - Active development` — la
versión mínima del repo (22.19.0) nunca sale de esa estabilidad, según la
verificación de arriba.

**Consecuencia operativa directa: el VPS de despliegue (Fase 10) debe
correr todo el stack de OpenAlice —no solo el Engine— sobre Node 24.x
LTS ("Krypton"), no sobre 22.19.0.** Esto no rompe nada: 24.x sigue
cumpliendo el piso `>=22.19.0` que el resto del monorepo exige, así que un
solo binario de Node 24.x LTS en el VPS sirve para los cuatro procesos
(Guardian, Alice, UTA, Engine) sin necesitar un runtime distinto por
proceso. Se prefiere esto a que `scripts/guardian/prod.mjs` aprenda a
lanzar el Engine con un `OPENALICE_ENGINE_RUNTIME_EXECUTABLE` separado del
resto — ese archivo está fuera de alcance de esta fase (M9, diferido por
ADR-0001) y añadir esa rama de complejidad ahí para resolver un problema
que un simple pin de versión en el VPS ya resuelve sería desproporcionado.

Motivos, en orden de peso (revisados):

1. `node:sqlite` en `>=24.15.0` alcanza `1.2 - Release candidate` — el
   nivel de madurez que corresponde a un sistema que, aunque no ejecuta
   órdenes directamente desde su propio SQLite, sí es el journal de
   decisiones de un motor de trading.
2. Cero fricción sobre `pnpm-workspace.yaml` del monorepo — sigue sin
   tocarse `allowBuilds` ni ningún archivo raíz compartido; el pin de
   versión vive enteramente en `services/engine/package.json`.
3. El Engine, tal como lo define PROMPT_MASTER, es de un solo proceso, sin
   concurrencia multi-proceso sobre el mismo archivo `.db` — el caso de
   uso no exige las garantías adicionales de `better-sqlite3` bajo alta
   concurrencia.

## Consecuencias

- **Divergencia de versión de Node dentro del mismo monorepo**: por
  primera vez, un paquete (`services/engine`) exige más que el piso raíz.
  Cualquier máquina con Node por debajo de 24.15.0 — incluida esta propia
  máquina de desarrollo, que corre v24.12.0 — no cumple el nuevo piso.
  Verificado en el momento de escribir esta corrección: `pnpm typecheck`
  y `pnpm test` de `services/engine` siguen funcionando igual en v24.12.0,
  solo con `[WARN] Unsupported engine` de pnpm — no es un fallo duro,
  es una advertencia que un CI con `engine-strict` sí convertiría en
  error. Trade-off aceptado a cambio de la estabilidad real de
  `node:sqlite`. Documentado aquí para que no sea una sorpresa en Fase 2+.
- El despliegue real (Fase 10, `deploy/RUNBOOK.md`) debe fijar
  explícitamente Node 24.x LTS como requisito del VPS — no es un detalle
  interno del Engine, es un requisito de infraestructura que debe quedar
  en el runbook cuando se escriba.
- La palabra "experimental" sigue siendo real incluso en `1.2 - Release
  candidate` (todavía no es `2 - Stable`): un upgrade de Node podría
  cambiar el comportamiento de `node:sqlite` sin que el repo lo controle.
  Se acepta este riesgo porque el Engine todavía no tiene código de datos
  — cuando `src/db/` se implemente, su suite de tests hermética (per
  `docs/testing.md`, Fase 0 [DOCUMENTACIÓN]) debe cubrir el comportamiento
  real usado, no solo asumirlo.
- Si Bun resulta no soportar `node:sqlite` en el modo de compatibilidad que
  usa este repo, y el Engine necesitara correr bajo Bun, este ADR tendría
  que reabrirse — sigue sin verificarse, sin cambios respecto a la versión
  anterior de este ADR.

## Cómo revertirla

Dos reversiones independientes:

1. **Cambiar de driver** (`node:sqlite` → `better-sqlite3`): acotado al
   futuro `src/db/` del Engine (adaptador con una interfaz mínima tipo
   `execute`/`query`/`transaction`) más, en ese momento, añadir
   `better-sqlite3` a `allowBuilds` en `pnpm-workspace.yaml` y a
   `services/engine/package.json`. También revertiría la necesidad del
   piso `>=24.15.0` — `better-sqlite3` no tiene ese requisito de Node.
   No afecta datos ya persistidos si ocurre antes de que el Engine tenga
   usuarios reales; después, requeriría exportar/reimportar el `.db`
   (mismo formato de archivo, sin cambio de esquema).
2. **Bajar el piso de Node de `services/engine`** de vuelta a
   `>=22.19.0` sin cambiar de driver: revierte la garantía de
   `1.2 - Release candidate` y vuelve a `1.1 - Active development` — solo
   tiene sentido si en el futuro se decide que esa madurez menor es
   aceptable después de todo, o si Node retro-mejora la línea v22 (no
   ocurrió hasta la fecha de esta verificación).

## Pregunta abierta para el humano

Dos preguntas, no una:

1. ¿Es aceptable el riesgo "experimental" (`1.2 - Release candidate`, no
   `2 - Stable`) de `node:sqlite` para un sistema que eventualmente tocará
   ejecución de órdenes (aunque el propio SQLite del Engine solo guarda el
   journal/decisiones, nunca las escrituras de broker, que siguen siendo
   responsabilidad exclusiva de UTA)? Si no, la Opción A (`better-sqlite3`)
   es la alternativa directa.
2. ¿Es aceptable fijar Node 24.x LTS como requisito del VPS de producción
   (Fase 10) y de cualquier entorno de desarrollo que toque
   `services/engine`, divergiendo del piso `>=22.19.0` del resto del
   monorepo? Esta pregunta es nueva en la corrección de hoy y es
   independiente de la primera — incluso si se prefiriera `better-sqlite3`,
   seguiría siendo razonable evaluar si todo el stack debería estar en
   Node 24.x de todos modos, dado que v22 ya está en Mantenimiento.
