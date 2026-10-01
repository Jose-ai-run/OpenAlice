# ADR-0011: Pre-registro del backtest F6 — universo, grilla, costos, walk-forward, gates, criterio de corte

**Estado:** Aceptado — pre-registrado antes de correr cualquier backtest
**Fecha:** 2026-10-01
**Fase:** F6 (Backtesting)

## Contexto

PROMPT_MASTER_CLAUDE_CODE.md §22 y la instrucción explícita de esta
sesión piden un backtest con criterio de corte objetivo: **todo lo que
seleccione qué se prueba, con qué costos, con qué gates y con qué
corte de aprobación/rechazo se fija AQUÍ, por escrito, antes de ver un
solo resultado OOS**, y este documento se commitea antes del paso 1 del
bloque. Después de ver resultados, **nada de esto cambia** — ni los
parámetros, ni los gates, ni los costos, ni la grilla.

## 1. Universo

- Activos: `BTC/USDT:USDT` y `ETH/USDT:USDT` perpetuos, fuente
  `bybit-readonly` (los mismos aliceIds ya verificados en Hito 1 — ver
  [[docs/trading-engine/AUDIT.md]] §14.3).
- Intervalos: `1h` (descargado directo) y `4h` (derivado del `1h` por
  agregación de 4 velas consecutivas alineadas a límites de 4h UTC —
  nunca descargado aparte, para que ambos intervalos sean
  consistentes entre sí por construcción).

## 2. Grilla de estrategias — fija, ≤20 combinaciones por estrategia

Estrategias A-E ya implementadas (`services/engine/src/strategies/*.ts`,
Fase 3). Grilla exacta (cualquier parámetro no listado usa su default
del schema):

- **A — trend-following**: `(fastPeriod, slowPeriod)` ∈
  `{(10,30), (5,20), (20,50)}` × `atrStopMultiplier` ∈ `{2, 3}` →
  **6 combinaciones**. `atrPeriod=14` fijo.
- **B — mean-reversion**: `rsiPeriod` ∈ `{10, 14}` ×
  `(oversold, overbought)` ∈ `{(30,70), (20,80)}` →
  **4 combinaciones**. `exitMid=50`, `stopPct=0.02` fijos.
- **C — breakout**: `lookback` ∈ `{10, 20, 55}` × `stopBufferPct` ∈
  `{0.005, 0.01}` → **6 combinaciones**.
- **D — momentum**: `period` ∈ `{10, 20}` × `threshold` ∈
  `{0.03, 0.05}` → **4 combinaciones**. `stopPct=0.03`,
  `timeStopBars=20` fijos.
- **E — regime-switch**: `adxThreshold` ∈ `{20, 25, 30}`,
  `adxPeriod=14`, sub-parámetros `trending`/`ranging` en su default →
  **3 combinaciones**.

Total: 23 combinaciones de estrategia×parámetros × 2 activos × 2
intervalos = **92 variantes** evaluadas en walk-forward. Este número
(`N=92`) es el que se usa en el ajuste por pruebas múltiples del gate
de Sharpe (§5).

Los topes de ≤20/estrategia del enunciado son un **máximo**, no un
objetivo — se eligió una grilla más pequeña para mantener el cómputo
acotado; ninguna estrategia alcanza el tope.

## 3. Modelo de costos (conservador, configurable, fijo)

- **Comisión:** 6 bps por lado (taker), aplicada a la entrada y a la
  salida — aproximación conservadora redondeada hacia arriba de la
  comisión taker real de perpetuos en Bybit (~5.5 bps) citada en
  `docs/trading-engine/` previamente para este venue.
- **Slippage:** 5 bps por lado, aplicado en contra del trade (entrada
  peor, salida peor).
- **Desempate stop/target en la misma vela:** si ambos niveles caen
  dentro del rango `[low, high]` de una misma vela, **gana el stop**
  (asunción conservadora explícita — PROMPT_MASTER §22).
- **Modelo de llenado:** la entrada se ejecuta a la **apertura de la
  vela siguiente** a la que generó la señal (nunca en la misma vela
  que decide — refuerza no-lookahead a nivel de ejecución, no solo de
  datos). El stop/target, cuando se tocan, se llenan al nivel exacto
  del stop/target (no al precio de la vela), consistente con una orden
  stop/limit real.
- **Funding:** NO modelado en el backtest primario (los gates se
  evalúan sin funding). Se incluye un **análisis de sensibilidad**
  aparte (no es un gate): se recalcula el PnL neto de cada combinación
  ganadora bajo 3 escenarios de costo de funding constante — 0, 5 y 10
  bps/día sobre el notional de la posición abierta — y se reporta el
  efecto en `docs/trading-engine/BACKTEST-REPORT.md`, nunca usado para
  aprobar/rechazar.

## 4. Walk-forward

- **In-sample (IS):** 12 meses. **Out-of-sample (OOS):** 3 meses,
  rodante (la ventana IS avanza 3 meses cada paso, igual que la OOS).
- **Holdout final:** los últimos 6 meses del dataset descargado. **No
  se tocan** hasta que todas las combinaciones hayan pasado (o no) el
  walk-forward sobre el resto de la historia.
- Los parámetros de cada combinación son **fijos** por la grilla
  (§2) — el walk-forward no re-optimiza parámetros por fold; evalúa la
  MISMA combinación en cada fold OOS y agrega los trades de todos los
  folds OOS (excluyendo el holdout) para los gates.

## 5. Gates (todos obligatorios, sobre OOS agregado, netos de costos)

1. **≥200 trades** agregados en OOS: o **≥100** si la estrategia es de
   baja frecuencia (menos de 1 trade/semana en promedio sobre el
   universo OOS) **y** el período OOS agregado cubre **≥3 regímenes**
   — definido aquí como ≥3 transiciones trending↔ranging
   (`classifyRegimeSeries`, ADX 14, umbral 25) dentro del rango OOS
   agregado.
2. **IC 95% bootstrap de la expectativa (en R) > 0**: remuestreo con
   reemplazo de los trades OOS, 2000 iteraciones, percentil 2.5 de la
   expectativa media remuestreada > 0.
3. **Profit factor ≥ 1.2** (suma de ganancias / suma de pérdidas,
   OOS).
4. **Max drawdown ≤ 12%** sobre la curva de equity OOS agregada
   (encadenando los folds en orden cronológico).
5. **Sharpe ≥ 0.8, ajustado por N=92 variantes probadas**: método fijo
   — corrección de Bonferroni sobre el nivel de confianza del
   bootstrap del propio Sharpe: en vez de un IC 95% simple, se exige
   que el límite inferior de un IC al `1 - 0.05/92 ≈ 99.946%` (2000
   remuestreos de los retornos por trade) del Sharpe anualizado supere
   0.8. Es un criterio deliberadamente más estricto que un Sharpe
   puntual ≥0.8 — una variante que pase este gate tiene que ser
   robusta, no solo afortunada entre 92 intentos.
6. **Estabilidad ±20% en parámetros**: para la combinación ganadora,
   cada combinación VECINA en la grilla de esa misma estrategia (que
   difiere en un solo parámetro, al valor adyacente probado) debe
   tener un Sharpe OOS dentro de ±20% del Sharpe de la ganadora. Si
   ninguna combinación vecina existe en la grilla (caso de borde), el
   gate se marca `N/A` y no bloquea por sí solo, pero se reporta
   explícitamente como tal.
7. **Ningún mes aporta más del 30% del PnL** total OOS (agregado por
   mes calendario sobre todos los folds OOS encadenados).
8. **Tests de no-lookahead y determinismo en verde**: los specs ya
   existentes por estrategia (`*.spec.ts`, Fase 3) más el nuevo spec
   del backtester (`backtest/engine.spec.ts`) deben pasar — ver §7.

## 6. Referencia informativa (NO es gate)

Buy-and-hold del mismo activo sobre el mismo rango OOS agregado:
retorno total, max drawdown, Sharpe anualizado. Se muestra en la tabla
del reporte junto a cada combinación, nunca usado para aprobar/rechazar
ni para ajustar ningún gate.

## 7. A3 — monotonía de la expectativa por quintil de score

Cada `ENTER` lleva `score ∈ [0,1]` (ya en el contrato de
`StrategyDecision`, Fase 3). Para cada combinación evaluada: ordenar
los trades OOS por `score`, partir en 5 quintiles, calcular la
expectativa media (en R) de cada quintil. **PASS** si la correlación de
Spearman entre el rango del quintil (1..5) y su expectativa media es
**≥ 0** (tendencia no decreciente) — no exige monotonía estricta
quintil a quintil, exige que la tendencia global no sea negativa. Con
menos de 5 trades por quintil en promedio, el chequeo se marca `N/A`
(muestra insuficiente) y no bloquea por sí solo.

## 8. A4 — frozen_at por versión de estrategia

Cada combinación de la grilla queda **congelada** con
`frozen_at = 2026-10-01T00:00:00.000Z` (el momento de este ADR) y
`strategy_version` (el campo `version` ya expuesto por cada
`Strategy`, Fase 3). Todo `run_id` de backtest persiste
`strategy_id + strategy_version + params_hash + frozen_at` — un cambio
posterior al código de una estrategia (nueva `version`) invalida la
comparación directa con una corrida anterior sin re-ejecutar.

## 9. Reproducibilidad

- `run_id` determinístico: `sha256(strategy_id|strategy_version|params_json|symbol|interval|datasetHash|foldIndex)`.
- El dataset (`market_bars`, hash por §1 de PROMPT_MASTER §37 F2) se
  descarga una sola vez; todas las 92 variantes × folds leen el MISMO
  dataset persistido — ninguna variante descarga su propia copia.
- Toda variante probada (pase o no los gates) queda registrada — cuenta
  para el ajuste de §5.5 aunque no se promueva a holdout.

## 10. Criterio de corte (mecánico, sin excepciones)

Solo las combinaciones que pasen **TODOS** los gates de §5 en
walk-forward pasan al holdout (§4), evaluado **una sola vez** cada una.
Para que una combinación se declare **aprobada**, debe pasar también
**TODOS** los gates de §5 recalculados sobre el holdout (mismos
umbrales, mismo método).

**Si ninguna combinación estrategia×activo×intervalo pasa todos los
gates en walk-forward Y en holdout: la recomendación es DETENER la
inversión en el motor.** No se agregan estrategias fuera de la grilla
de §2, no se relajan gates, no se amplía el universo, no se reinterpreta
ningún umbral después de ver un resultado. La sección "DECISIÓN" de
`docs/trading-engine/BACKTEST-REPORT.md` aplica este criterio
mecánicamente sobre la tabla de resultados, sin redacción optimista.

## Cómo revertirla

Este ADR fija el diseño del backtest F6 específicamente — no bloquea
una fase posterior que decida correr un backtest NUEVO con una grilla o
gates distintos, siempre que sea un documento de pre-registro nuevo
(ADR-00NN siguiente), nunca una edición de este tras ver resultados.
