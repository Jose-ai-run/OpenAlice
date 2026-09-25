# ADR-0004: Política de riesgo en archivo RO del host

**Estado:** Propuesto — diseño únicamente, **cero implementación en Fase 1**
**Fecha:** 2026-09-24
**Fase:** F1 (Architecture)

## Contexto

Fase 0 re-verificó los tres guards existentes de UTA
(`services/uta/src/domain/trading/guards/`, [VERIFICADO EN REPOSITORIO]) y
confirmó sus defectos exactamente como los describe PROMPT_MASTER §1
hallazgo 2:

- `max-position-size.ts:35`: si no puede estimar el valor añadido, **permite
  la orden** ("If we can't estimate… allow — broker will validate") — falla
  **abierto**.
- `cooldown.ts`: estado en un `Map` **en memoria** (`private lastTradeTime =
  new Map()`), se pierde al reiniciar; y registra el timestamp
  (`this.lastTradeTime.set(symbol, now)`, línea 30) en cuanto **su propio**
  check pasa, sin saber todavía si un guard posterior en el pipeline va a
  rechazar la operación completa.
- `registry.ts:28-31`: un tipo de guard desconocido en la config se omite
  con `console.warn` y `continue` — **no** falla cerrado; un typo en
  `accounts.json` desactiva un guard en silencio.

**Matiz encontrado en Fase 0, no presente en el documento de referencia
tal cual:** la afirmación "los guards solo evalúan `placeOrder`" es cierta
para `max-position-size.ts` y `cooldown.ts` (ambos tienen
`if (ctx.operation.action !== 'placeOrder') return null` como primera
línea de `check()`), pero **`symbol-whitelist.ts` no tiene ese guard de
acción** — su `check()` llama a `getOperationSymbol(ctx.operation)` sin
filtrar por `action`, así que ya evalúa **cualquier** operación con símbolo,
incluida `modifyOrder`. Esto importa directamente para el diseño de abajo:
el nuevo RiskEngine no puede asumir que "cubrir `modifyOrder`" es un problema
uniforme para los tres guards — ya es dispar entre ellos hoy.

Consecuencia de diseño: las reglas R* del RiskEngine (PROMPT_MASTER §14)
que reemplacen o envuelvan la lógica de símbolo/whitelist deben preservar
que `modifyOrder` ya está cubierto por ese caso; las que reemplacen
`max-position-size` y `cooldown` sí necesitan **añadir** cobertura de
`modifyOrder` que hoy no existe (R8/R13/R18 en la numeración de §14).

`guard-pipeline.ts:20-36` confirma además que el pipeline evalúa **todos**
los guards configurados sobre **cada** operación (`for (const guard of
guards) { const rejection = await guard.check(ctx) … }`) — el punto de
inserción correcto para el RiskEngine es *antes* de este bucle, como
primer paso, tal como pide M1 (PROMPT_MASTER §5): `RiskEngine.check` como
PRIMER paso del dispatcher, antes de los guards existentes.

## Opciones consideradas

### Opción A — Política mutable vía API (como `accounts.json`)

- Descartada. PROMPT_MASTER §14 es explícito: "Ninguna API escribe la
  política." Una política de riesgo editable por HTTP reintroduce
  exactamente el problema que Fase 0 encontró en `allowAiTrading` y
  `guards[]`: viven en archivos escribibles por el mismo usuario del SO que
  ejecuta los agentes (`src/core/config.ts`, [VERIFICADO EN REPOSITORIO] en
  Fase 0). Un agente con shell podría, en principio, relajar su propio
  límite.

### Opción B — Política en el mismo `accounts.json` de Alice

- Descartada. Mezclaría el modelo de configuración mutable de Alice
  (editable desde la UI, [VERIFICADO EN REPOSITORIO] `src/core/config.ts`)
  con algo que PROMPT_MASTER exige que sea de **solo lectura desde el
  proceso de trading**. Los `guards[]` de `accounts.json` no desaparecen
  (siguen activos, "solo pueden añadir restricciones" — PROMPT_MASTER §14),
  pero la política nueva no puede vivir en el mismo archivo que ellos sin
  heredar su mutabilidad.

### Opción C — Archivo montado RO desde el host, hash + fail-closed — **elegida**

## Decisión (diseño, no implementación)

**Ubicación:** `/etc/openalice/risk-policy.json` (host, montado **RO** en el
contenedor/proceso de UTA — PROMPT_MASTER §10), con
`OPENALICE_RISK_POLICY_PATH` como override para desarrollo local (no todo
desarrollador tiene `/etc/openalice/` en Windows/macOS — la Fase 0 corrió
en Windows y esa ruta no existe ahí de forma nativa).

**Esquema (Zod, PROMPT_MASTER §10):** `version`, `timezone`,
`executionModeMax`, y por cuenta: `allowedSymbols`, `allowedSecTypes`,
`allowedActions`, `tradingHours`, `maxOrderNotional`,
`maxPositionNotional`, `maxPositionPctEquity`,
`maxGrossExposurePctEquity`, `maxNetExposurePctEquity`, `maxLeverage`,
`maxOpenPositions`, `maxTradesPerDay`, `maxTradesPerSymbolPerDay`,
`cooldownSecondsPerSymbol`, `maxRiskPerTradePctEquity`,
`requireStopLoss`, `maxDailyLossPctEquity`, `maxDrawdownPctFromHWM`,
`priceBandPct`, `maxQuoteAgeSeconds`, `maxConsecutiveRejects`,
`capitalCap`. Este ADR no redefine ese esquema — lo hereda literal de
PROMPT_MASTER §10, que ya lo especifica.

**Carga:**

1. Al boot de UTA (después de esta fase, cuando M1 se implemente): leer el
   archivo, parsear con Zod, calcular `sha256(contenido canónico)` →
   `policyHash`.
2. Falla de lectura, JSON inválido, o falla de validación Zod → **UTA se
   niega a arrancar en modo trading** (mismo espíritu que la Opción C de
   ADR-0003 para el bind no-loopback sin tokens). No hay "arrancar con
   valores por defecto silenciosos" — sería exactamente el fallo abierto
   que Fase 0 encontró en `resolveGuards`.

**Recarga:** `SIGHUP` o reinicio del proceso — nunca hot-reload disparado
por una petición HTTP (eso reabriría la Opción A). Mismo mecanismo que
`data/control/restart-uta.flag` ya usa para cambios de config de broker
(`docs/project-structure.md`, [VERIFICADO EN REPOSITORIO] en Fase 0), pero
la política de riesgo usa `SIGHUP` en vez del flag porque **no** debe pasar
por ninguna ruta HTTP de Alice — el host controla el reinicio, no el
producto.

**Comportamiento fail-closed en runtime** (PROMPT_MASTER §14, sin cambios):
"Datos faltantes, excepción, política ausente o inválida, estado corrupto
→ rechazar / HALT_NEW." Este ADR no relaja eso.

**`policyHash` en cada decisión:** cada evaluación del RiskEngine registra
`policyHash` en `risk-decisions.jsonl` (PROMPT_MASTER §14) — permite
demostrar retroactivamente bajo qué política se evaluó cada operación, sin
necesitar guardar la política completa en cada línea del log.

## Consecuencias

- Ningún componente del producto (Alice, el Engine, la UI) puede escribir
  esta política — solo un operador con acceso al host. Esto es una
  fricción deliberada: cambiar los límites de riesgo requiere una acción
  fuera del sistema que el LLM controla.
- El desarrollo local en Windows/macOS necesita `OPENALICE_RISK_POLICY_PATH`
  apuntando a un archivo de ejemplo (`deploy/examples/risk-policy.example.json`,
  PROMPT_MASTER §10) — sin eso, UTA en modo trading no arrancaría en una
  máquina de desarrollo sin `/etc/openalice/`. Fuera del alcance de esta
  Fase 1 crear ese ejemplo (no hay lógica de negocio que lo lea todavía).

## Cómo revertirla

Mientras el RiskEngine no esté implementado (Fases 1–3), no hay nada que
revertir: este documento es solo diseño. Una vez implementado (M1, Fase 4),
revertir a "sin RiskEngine" es el mismo mecanismo de feature flag que
PROMPT_MASTER §35 (Rollback) ya exige para toda modificación de UTA:
`OPENALICE_RISK_STRICT` sin configurar (o la ausencia del archivo de
política combinada con un modo no-trading) preserva el comportamiento
original de los tres guards heredados, sin el RiskEngine como primer paso.
