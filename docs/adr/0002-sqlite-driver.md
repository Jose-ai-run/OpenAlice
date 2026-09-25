# ADR-0002: Driver SQLite — `node:sqlite` vs `better-sqlite3`

**Estado:** Aceptado (decisión de driver); implementación diferida a una fase posterior
**Fecha:** 2026-09-24
**Fase:** F1 (Architecture)

## Contexto

PROMPT_MASTER_CLAUDE_CODE.md §8 pide SQLite en modo WAL, `busy_timeout`,
`foreign_keys=ON`, con migraciones SQL versionadas y tabla
`schema_migrations`, y plantea explícitamente la disyuntiva como "ADR de la
Fase 1": `node:sqlite` (verificar disponibilidad/estabilidad en la versión
de Node fijada, ≥ 22.19, y bajo Bun si el runtime lo usa) vs
`better-sqlite3` (nativo: requiere añadirse a `allowBuilds` en
`pnpm-workspace.yaml`).

Verificación hecha en esta Fase 1, en esta máquina (Windows 11, Node
v24.12.0 — la misma versión con la que se corrió la Fase 0):

```
node -e "const s = require('node:sqlite'); const db = new s.DatabaseSync(':memory:'); db.exec('CREATE TABLE t(a)'); console.log('node:sqlite OK')"
```

Resultado real:

```
function
node:sqlite OK
(node:...) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

[VERIFICADO EN REPOSITORIO/RUNTIME]: `node:sqlite` **existe y funciona** en
Node v24.12.0, pero emite `ExperimentalWarning` — su API puede cambiar sin
aviso entre versiones menores de Node, incluso dentro del rango `>=22.19.0`
que fija `package.json` `engines` (Fase 0, [VERIFICADO EN REPOSITORIO]).

`better-sqlite3`: **NO ENCONTRADO EN EL REPOSITORIO** — no es dependencia de
ningún paquete hoy (`grep -rn "better-sqlite3" package.json
pnpm-workspace.yaml services/*/package.json packages/*/package.json` →
sin resultados). Tampoco está en `allowBuilds` de `pnpm-workspace.yaml`
(la lista actual es `bufferutil, ccxt, dugite, electron,
electron-winstaller, esbuild, msw, node-pty, protobufjs` — todas
[VERIFICADO EN REPOSITORIO]).

Nota sobre Bun: `package.json` declara Bun 1.4.0 como runtime alternativo
de distribución (`.bun-version`, `#openalice/pty-backend`, documentado en
el documento de referencia §2.1, [DOCUMENTACIÓN]). No se verificó en esta
fase si `node:sqlite` funciona bajo el modo de compatibilidad Node de Bun
— queda como pregunta abierta (§ "Riesgos" más abajo), porque el Engine no
tiene código de datos todavía.

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
no esta Fase 1). Motivos, en orden de peso:

1. Cero fricción sobre `pnpm-workspace.yaml` — esta Fase 1 tiene mandato
   explícito de "NO toques `src/` ni `services/uta/`" y de tocar solo
   `services/engine/`; añadir `better-sqlite3` a `allowBuilds` sería un
   cambio a un archivo compartido por las 17 paquetes del workspace,
   desproporcionado para lo que se necesita.
2. El Engine, tal como lo define PROMPT_MASTER, es de un solo proceso, sin
   concurrencia multi-proceso sobre el mismo archivo `.db` (a diferencia de,
   por ejemplo, un servidor web con múltiples workers) — el caso de uso no
   exige las garantías de madurez adicionales que ofrece `better-sqlite3`
   bajo alta concurrencia.
3. Está verificado que funciona en el Node exacto que fija el repo, en esta
   máquina, ahora mismo (evidencia arriba).

## Consecuencias

- La palabra "experimental" es real: un upgrade de Node podría cambiar el
  comportamiento de `node:sqlite` sin que el repo lo controle. Se acepta
  este riesgo porque el Engine todavía no tiene código de datos — cuando
  `src/db/` se implemente, su suite de tests hermética (per
  `docs/testing.md`, Fase 0 [DOCUMENTACIÓN]) debe cubrir el comportamiento
  real usado, no solo asumirlo.
- Si Bun resulta no soportar `node:sqlite` en el modo de compatibilidad que
  usa este repo, y el Engine necesitara correr bajo Bun, este ADR tendría
  que reabrirse.

## Cómo revertirla

Migrar de `node:sqlite` a `better-sqlite3` (o viceversa) es un cambio
acotado al futuro `src/db/` del Engine (adaptador con una interfaz mínima
tipo `execute`/`query`/`transaction`) más, en ese momento, añadir
`better-sqlite3` a `allowBuilds` en `pnpm-workspace.yaml` y a
`services/engine/package.json`. No afecta ningún dato ya persistido si la
migración ocurre antes de que el Engine tenga usuarios reales (Fases 1–3);
después de eso, requeriría exportar/reimportar el archivo `.db` — mismo
formato de archivo SQLite en ambos casos, sin cambio de esquema.

## Pregunta abierta para el humano

¿Es aceptable el riesgo "experimental" de `node:sqlite` para un sistema que
eventualmente tocará ejecución de órdenes (aunque el propio SQLite del
Engine solo guarda el journal/decisiones, nunca las escrituras de broker,
que siguen siendo responsabilidad exclusiva de UTA)? Si no, la Opción A
(`better-sqlite3`) es la alternativa directa y este ADR se puede revisar
antes de que `src/db/` tenga la primera línea de código real.
