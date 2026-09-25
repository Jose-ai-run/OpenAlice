# PROMPT MASTER — Sistema de trading automatizado experimental sobre OpenAlice

> Pega este prompt completo en Claude Code con el repositorio OpenAlice (fork) como directorio de trabajo.
> Idioma de trabajo: español para la comunicación; inglés para código, identificadores, commits y docs técnicas del repo (convención del proyecto).

---

## 0. TU ROL Y TU MANDATO

Actúas como ingeniero principal de un fork de OpenAlice. Vas a construir, **por fases y con gates**, una infraestructura de trading automatizado **experimental, auditable, modular y segura**. No es un bot "para ganar dinero": es un sistema para **medir** estrategias con criterios objetivos y operar solo dentro de límites de riesgo determinísticos que la IA no puede modificar.

Reglas absolutas:
- **No inventes nada.** Ni APIs, ni endpoints, ni variables de entorno, ni funciones, ni rutas, ni flags de CLI. Si algo no está en el repo, créalo explícitamente como código nuevo, o dilo con la frase literal **"NO ENCONTRADO EN EL REPOSITORIO"**.
- **Nunca envíes órdenes reales durante el desarrollo.** Solo `MockBroker`, cuentas demo/paper/testnet verificadas, y solo en las fases que lo permiten.
- **Nunca hagas cambios destructivos sin confirmación explícita** (borrar código funcional, reescribir el historial, force-push, borrar datos de `~/.openalice`, cambiar formatos persistidos ya publicados sin migración).
- Etiqueta tus afirmaciones en informes y ADRs como `[VERIFICADO EN REPOSITORIO]`, `[DOCUMENTACIÓN]`, `[INFERENCIA]` o `[PROPUESTA]`. Si README y código discrepan, manda el código: explica la discrepancia.

---

## 1. CONTEXTO DEL PROYECTO

OpenAlice (TypeScript, pnpm monorepo, AGPL-3.0) es un orquestador local que lanza agentes de código nativos (Claude Code, Codex, etc.) dentro de Workspaces y separa todas las escrituras de trading en el proceso **UTA**. Lee primero, en este orden: `AGENTS.md`, `docs/README.md`, `docs/project-structure.md`, `services/uta/src/domain/trading/README.md`, `docs/uta-live-testing.md`, `docs/testing.md`, `docs/workspace-issues-and-scheduling.md`, `docs/market-data-architecture.md`, `safe/THREAT_MODEL.md`.

Reglas del proyecto que DEBES respetar (de `AGENTS.md`):
- `src/` es Alice; `services/uta/` es el dueño de brokers, cuentas, aprobaciones y escrituras de trading. No muevas estado de broker a Alice.
- "Do not grow a parallel workflow engine in `src/`" → el motor de estrategias va en un **servicio aparte** (`services/engine`), no en `src/`.
- ESM, imports con extensión `.js`, TypeScript estricto, Zod para configs, `decimal.js` para dinero.
- La persistencia de OpenAlice es de archivos; los cambios en formatos persistidos ya publicados requieren migración idempotente (`src/migrations/` + índice generado).
- Nunca secretos en archivos versionados, logs, fixtures ni cuerpos de PR.
- Tipado de trading desde `@traderalice/ibkr` y `@traderalice/uta-protocol`.

Hallazgos de la auditoría previa (commit `0d4faa90`, v0.94.1). **Re-verifícalos en la Fase 0; el repo cambia a diario:**
1. Todas las escrituras hacia el broker pasan por `UnifiedTradingAccount` → `createGuardPipeline(dispatcher, broker, guards)` → `TradingGit.push` (`services/uta/src/domain/trading/UnifiedTradingAccount.ts`, constructor). Es el único cuello de botella de escritura.
2. Guards existentes: `max-position-size`, `cooldown`, `symbol-whitelist` (`services/uta/src/domain/trading/guards/`). Defectos: solo evalúan `placeOrder`; `max-position-size` permite la orden si no puede estimarla; `cooldown` en memoria y registra el tiempo aunque otro guard rechace; tipos desconocidos se omiten con un warning.
3. UTA escucha en `127.0.0.1:47333` sin autenticación (`services/uta/src/main.ts`). `POST /api/trading/uta/:id/wallet/push` y `POST /api/trading/uta/:id/wallet/place-order` (stage+commit+push en una llamada) están en `services/uta/src/http/routes-trading.ts`. Alice deja pasar peticiones de loopback sin token (`src/webui/plugin.ts`, `src/webui/middleware/auth.ts`).
4. La IA puede hacer push solo si `agent.allowAiTrading=true` (`src/tool/trading.ts`, `src/core/config.ts`). Ese interruptor y los guards viven en archivos de `~/.openalice/data/config/` escribibles por el mismo usuario del SO.
5. `TradingGit` persiste solo `commits`+`head` en `data/trading/<id>/commit.json` con `writeFile` no atómico (`git-persistence.ts`); el staging y el commit pendiente están en memoria; el commit se escribe **después** de ejecutar en el broker. Solo puede haber **un** commit pendiente por cuenta.
6. No existen: motor de estrategias, señales, sizing, pérdida diaria, drawdown, kill switch, monitor de posiciones, backtester de órdenes, `clientOrderId`, Dockerfile de producción ni linter.
7. `scripts/guardian/prod.mjs`: UTA **no** se reinicia si muere inesperadamente; el Connector sí (con `RestartBackoff`); si Alice muere, Guardian entero termina.
8. Order-sync poller cada 10 s (`order-sync-poller.ts`); scanner de Issues cada ~60 s; máximo 8 ejecuciones headless.
9. `MockBroker` es un exchange en memoria completo, sin comisiones, slippage, feed de precios ni TRAIL; se controla con `/api/simulator/*` (`routes-simulator.ts`).
10. Datos de mercado por UTA: `POST /api/trading/uta/:id/historical` (intervalos `1m 5m 15m 30m 1h 4h 1d 1w`) y `POST /api/trading/uta/:id/quote`. Indicadores en `src/domain/analysis/indicator/functions/` (devuelven el último valor como `number`; no hay ADX).

---

## 2. OBJETIVO

Construir un sistema que corra 24/7 y que: obtenga datos; analice varios activos; clasifique el régimen; ejecute estrategias determinísticas modulares (A trend following, B mean reversion, C breakout, D momentum, E regime-based); dimensione posiciones; genere órdenes; las ejecute vía UTA en un broker compatible; monitoree posiciones y gestione stops, TP y trailing; cierre por reglas; registre **todas** las decisiones; aplique límites de riesgo **determinísticos** que la IA no puede alterar; tenga kill switch; se recupere de errores y reinicios; opere primero en backtest → paper → testnet y solo después en live con capital pequeño.

Los LLM **no** deciden órdenes. Roles LLM permitidos (fuera del camino crítico, como Issues programados de OpenAlice): ContextAnalyst (advisory de veto/reducción con TTL, en sombra hasta probar valor), TradeReviewer (resúmenes para aprobación humana) y PerformanceAnalyst (informes; propone cambios como Issues, nunca los aplica).

---

## 3. ARQUITECTURA EXISTENTE (a respetar)

```text
Guardian → UTA (:47333, autoridad de trading) · Alice (:47331, Workspaces/tools/UI) · Connector (:47334, opcional)
Alice → UTA vía HTTP (packages/uta-protocol/src/client/UTAClient.ts; src/services/uta-client/)
UI → Alice /api/trading/* → proxy → UTA (src/webui/routes/trading-proxy.ts)
Agentes → shims alice / alice-uta / traderhub → ToolCenter (src/core/tool-center.ts)
Trading as Git: stage → commit(message=tesis) → push(expectedPendingHash) → sync
```

---

## 4. COMPONENTES QUE DEBEMOS REUTILIZAR

`UTAClient` y tipos de `@traderalice/uta-protocol`; `Contract`/`Order` de `@traderalice/ibkr`; `TradingGit` (ledger e identidad de la decisión ejecutada); el pipeline de guards (punto de inserción del riesgo); todos los brokers y presets (demo/testnet); `MockBroker` + rutas del simulador; order-sync poller y `observeExternalOrders`; salud y reconexión de cuentas; snapshots; `cost-basis.ts` y `order-history.ts`; indicadores de `src/domain/analysis/indicator/functions/` (importables vía alias `@/`, como UTA ya hace con `@/core/*`); `src/domain/market-data/bars/{freshness,quality}.ts` como referencia; Issues programados + Inbox + Connector (Telegram) para los roles LLM y la aprobación móvil; `RestartBackoff` de `packages/guardian-runtime`; provenance (`src/server/trade-provenance.ts`); carriles de test existentes.

---

## 5. COMPONENTES QUE DEBEMOS MODIFICAR (mínimos, retrocompatibles, cada uno con tests)

- **M1** `UnifiedTradingAccount.ts`: insertar `RiskEngine.check` como PRIMER paso del dispatcher con guards (antes de los guards existentes); `RiskEngine.precheck` en `stage*` (informativo).
- **M2** `guards/registry.ts`: con `OPENALICE_RISK_STRICT=1`, un tipo desconocido lanza error (fail-closed). Sin la variable, el comportamiento actual no cambia.
- **M3** `guards/cooldown.ts`: registrar el timestamp solo tras un dispatch exitoso; leer y escribir en el estado de riesgo persistente.
- **M4** `git-persistence.ts`: escritura atómica (tmp + rename), mismo formato.
- **M5** `git/TradingGit.ts`: persistir y restaurar staging y commit pendiente en `data/trading/<id>/pending.json`.
- **M6** `StagePlaceOrderParams` (+ rutas, CLI y brokers): `clientOrderId` opcional → `Order.orderRef` → parámetro nativo de cada broker **solo tras verificar su soporte en el SDK instalado** (CCXT, Alpaca, IBKR); si un broker no lo soporta, documéntalo y no finjas soporte.
- **M7** `services/uta/src/main.ts`: auth por tokens con scopes (`read`, `stage`, `approve`, `engine`, `operator`, `simulator`) leídos de `OPENALICE_UTA_TOKENS_FILE`; `OPENALICE_UTA_BIND_HOST` (default `127.0.0.1`); negarse a arrancar en bind no-loopback sin tokens; en loopback sin tokens → modo compatibilidad con warning.
- **M8** `UTAClient`, `src/services/uta-client/*`, `src/webui/routes/trading-proxy.ts`: enviar `Authorization: Bearer` si hay token.
- **M9** `scripts/guardian/prod.mjs`: (a) reiniciar UTA con `RestartBackoff`; (b) `OPENALICE_UTA_EXTERNAL=1` para no lanzar UTA y usar `OPENALICE_UTA_URL`; (c) supervisar `services/engine` como servicio opcional (patrón Connector).
- **M10** `MockBroker.ts`: `feeBps` y `slippageBps` opcionales en su config (default 0).
- **M11** `src/tool/trading.ts`: `tradingPush` consulta además el modo efectivo que expone UTA.
- **M12** Documentación: actualizar `docs/project-structure.md`, `docs/uta-live-testing.md` y `docs/README.md`; crear `docs/trading-engine.md` y `docs/risk-engine.md`.

---

## 6. COMPONENTES NUEVOS

RiskEngine + KillSwitch (en UTA); `services/engine` con: Scheduler, MarketDataStore, Features, RegimeClassifier, Strategy SDK + estrategias A–E, Aggregator, AdvisoryFilter, PositionSizer, ExecutionManager (WAL), PositionMonitor, Reconciler, Backtester, Metrics & Gates, DecisionJournal, Alerts, API HTTP; skills/plantilla "trading-desk" para los roles LLM; `deploy/` (Dockerfiles, compose, systemd, backup, runbook).

---

## 7. ESTRUCTURA DE DIRECTORIOS (nuevos)

```text
services/uta/src/domain/trading/risk/
  policy.ts            # schema Zod + loader (hash, fail-closed)
  rules/*.ts           # una regla por archivo (R0–R20), funciones puras
  risk-engine.ts       # orquesta reglas; devuelve RiskVerdict
  risk-state.ts        # estado persistente atómico
  risk-log.ts          # risk-decisions.jsonl
  kill-switch.ts
  *.spec.ts
services/uta/src/http/routes-risk.ts   # GET estado/política(hash)/decisiones; POST kill-switch (operator)
services/uta/src/http/auth.ts          # middleware de tokens/scopes
services/engine/
  package.json  tsconfig.json  tsup.config.ts
  config/{engine.yaml,strategies.yaml}           # sin secretos
  migrations/0001_init.sql
  src/main.ts
  src/config/            src/clock/            src/db/
  src/uta/               # cliente UTA tipado (usa UTAClient + token)
  src/data/              # fetch, cache, quality, freshness
  src/features/          src/indicators-series/  src/regime/
  src/strategies/{types.ts,registry.ts,trend-following.ts,mean-reversion.ts,breakout.ts,momentum.ts,regime-switch.ts}
  src/aggregate/         src/advisory/         src/sizing/
  src/execution/{intent-state-machine.ts,execution-manager.ts,reconciler.ts,rate-limit.ts}
  src/monitor/           src/backtest/{engine.ts,fill-model.ts,walk-forward.ts,report.ts}
  src/metrics/           src/gates/            src/journal/
  src/alerts/            src/http/             src/cli/
  test/{e2e,chaos,property}/
default/skills/trading-desk-context/SKILL.md     # y reviewer / performance
deploy/{uta.Dockerfile,engine.Dockerfile,alice.Dockerfile,compose.yaml,systemd/,backup/,RUNBOOK.md}
docs/{trading-engine.md,risk-engine.md,adr/NNNN-*.md}
```

---

## 8. DATABASE SCHEMA

SQLite en el Engine (modo WAL, `busy_timeout`, `foreign_keys=ON`), con migraciones SQL versionadas y tabla `schema_migrations`. **ADR de la Fase 1:** `node:sqlite` (verificar disponibilidad y estabilidad en la versión de Node fijada, ≥ 22.19, y bajo Bun si el runtime lo usa) vs `better-sqlite3` (nativo: requiere añadirlo a `allowBuilds` en `pnpm-workspace.yaml`). Tablas mínimas (tipos monetarios como TEXT decimal):

`schema_migrations`, `config_versions`, `strategies`, `market_bars` (PK source+symbol+interval+open_time), `datasets`, `cycles`, `feature_snapshots`, `regimes`, `decisions` (una por estrategia×símbolo×ciclo, incluidas las NONE; con reason_codes, score, entry/stop/target, advisory, contrafactual, sizing), `llm_advisories`, `risk_mirror_checks`, `order_intents` (client_order_id UNIQUE, state, mode, uta_commit_hash, broker_order_id, expires_at), `order_events` (WAL de transiciones), `fills`, `managed_positions`, `trades`, `equity_snapshots`, `reconciliations`, `kill_switch_events`, `backtest_runs`, `backtest_trades`, `stage_promotions`, `alerts`, `heartbeats`.

Del lado UTA (archivos, estilo del repo): `data/trading/_risk/risk-state.json` (atómico), `data/trading/_risk/risk-decisions.jsonl` (append-only), `data/trading/<id>/pending.json`.

---

## 9. ENVIRONMENT VARIABLES

Existentes (verifícalas): `OPENALICE_HOME`, `OPENALICE_UTA_PORT`, `OPENALICE_UTA_URL`, `OPENALICE_TRADING_MODE`, `OPENALICE_LITE_MODE`, `OPENALICE_BIND_HOST`, `OPENALICE_UTA_LIVE_PAPER` (tests).
Nuevas (créalas, documéntalas en `docs/` y valida con Zod al arrancar; nunca con valores secretos por defecto):
- UTA: `OPENALICE_UTA_BIND_HOST`, `OPENALICE_UTA_TOKENS_FILE`, `OPENALICE_RISK_POLICY_PATH`, `OPENALICE_CONTROL_DIR`, `OPENALICE_RISK_STRICT`.
- Guardian: `OPENALICE_UTA_EXTERNAL`, `OPENALICE_ENGINE_ENABLED`.
- Engine: `ENGINE_UTA_URL`, `ENGINE_UTA_TOKEN_FILE`, `ENGINE_DB_PATH`, `ENGINE_CONFIG_DIR`, `ENGINE_MODE` (`RESEARCH_ONLY|SIGNAL_ONLY|PAPER|HUMAN_APPROVAL|SEMI_AUTONOMOUS|FULLY_AUTOMATED`), `ENGINE_HTTP_PORT` (propuesta: 47340; verifica que no choque con `scripts/guardian/shared.ts`), `ENGINE_ALERT_TELEGRAM_TOKEN_FILE`, `ENGINE_ALERT_TELEGRAM_CHAT_ID`, `ENGINE_HEARTBEAT_URL`, `ENGINE_LOG_LEVEL`.
Los secretos siempre por `*_FILE` (Docker secrets o archivos 0600), nunca en el código ni en git.

---

## 10. CONFIGURATION FILES

- `/etc/openalice/risk-policy.json` (host, montado **RO** en UTA): esquema Zod con `version`, `timezone`, `executionModeMax` y, por cuenta: `allowedSymbols`, `allowedSecTypes`, `allowedActions`, `tradingHours`, `maxOrderNotional`, `maxPositionNotional`, `maxPositionPctEquity`, `maxGrossExposurePctEquity`, `maxNetExposurePctEquity`, `maxLeverage`, `maxOpenPositions`, `maxTradesPerDay`, `maxTradesPerSymbolPerDay`, `cooldownSecondsPerSymbol`, `maxRiskPerTradePctEquity`, `requireStopLoss`, `maxDailyLossPctEquity`, `maxDrawdownPctFromHWM`, `priceBandPct`, `maxQuoteAgeSeconds`, `maxConsecutiveRejects`, `capitalCap`. Incluye `deploy/examples/risk-policy.example.json` con valores conservadores.
- `services/engine/config/engine.yaml`: modo global, cuentas `engineOwned`, intervalos, fuente de datos por símbolo, rate limits, timeouts, `advisory_missing_policy`, alertas.
- `services/engine/config/strategies.yaml`: por estrategia `id`, `version`, `enabled`, `mode_cap`, `universe` (aliceIds reales obtenidos con contract search, nunca inventados), `interval`, `params`, `allocation`, `regimes_allowed`.
- Todas se hashean (sha256) y el hash se guarda en cada `cycle` y `decision`.

---

## 11. AGENTS

- No implementes un bucle de agente propio ni una cadena de agentes LLM en el camino crítico.
- Los roles LLM se implementan como **skills + Issues programados** en un Workspace "trading-desk" (reutiliza `src/workspaces/schedule/` e `issues/`; ver `default/skills/self-scheduling/SKILL.md`):
  - **ContextAnalyst** (`every: 4h` + pre-sesión): produce un advisory JSON validado (`action ∈ {NONE, VETO_NEW_LONGS, VETO_NEW_SHORTS, VETO_ALL_NEW, REDUCE_SIZE}`, `sizeMultiplier ∈ [0,1]`, `expiresAt ≤ 24 h`, `reasonCodes`, `evidence`) y lo envía a `POST /engine/advisory` con un token de scope `advisory:write`. No puede crear ni agrandar órdenes.
  - **TradeReviewer** (modo 4): resume el commit pendiente (DecisionRecord + riesgo) para aprobar en la UI o Telegram.
  - **PerformanceAnalyst** (diario/semanal): informe al Inbox; propone cambios como Issues; nunca edita configs.
- `agent.allowAiTrading` debe quedarse en `false`.

---

## 12. TOOLS

- No añadas tools de trading que ejecuten órdenes. Solo lectura del Engine: `engineStatus`, `engineWhy(symbol, at)`, `engineMetrics(strategyId)`, expuestas vía skill que llama a la API del Engine, **o** como tools en `src/tool/` que solo leen (sin un motor en `src/`). Documenta la elección en un ADR.
- Reutiliza las tools existentes de mercado y análisis para los roles LLM.

---

## 13. STRATEGIES

Interfaz pura:
```ts
interface Strategy {
  id: string; version: string; paramsSchema: z.ZodType
  warmup(params: unknown): Array<{ interval: BarInterval; bars: number }>
  evaluate(ctx: StrategyContext): StrategyDecision   // sin I/O, sin Date.now, sin azar sin semilla
}
```
`StrategyDecision` = `NONE | ENTER{side, entry, stop (obligatorio), target?, score 0..1, reasonCodes, timeStopBars?} | EXIT{reasonCodes} | ADJUST_STOP{newStop}` (solo puede apretar el stop). Implementa A–E como plantillas parametrizables **sin afirmar rentabilidad**. Implementa ADX y los helpers de series dentro del Engine con tests contra valores de referencia. Cada estrategia se puede activar, configurar, backtestear, paper-tradear y comparar, y todas sus filas llevan `strategy_id`, `strategy_version` y `params_hash`.

---

## 14. RISK ENGINE (dentro de UTA; determinístico; fail-closed)

- Se evalúa en el dispatcher (autoritativo) para `placeOrder` y `modifyOrder`; `closePosition` y `cancelOrder` siempre se permiten (con la validación de cantidad existente).
- Reglas en orden: R0 kill switch · R1 acción permitida · R2 cuenta · R3 símbolo/secType · R4 horario (`getMarketClock` o ventana; cripto `always`) · R5 frescura de quote · R6 banda de precio · R7 notional de la orden · R8 posición resultante (notional y % equity) · R9 exposición bruta/neta · R10 apalancamiento · R11 nº de posiciones · R12 trades/día · R13 cooldown · R14 stop obligatorio · R15 riesgo por trade · R16 pérdida diaria (dispara kill) · R17 drawdown desde HWM (dispara kill) · R18 modify: sin aumentar por encima de límites y stop solo a favor · R19 rechazos consecutivos (dispara kill) · R20 `capitalCap`.
- Datos faltantes, excepción, política ausente o inválida, estado corrupto → **rechazar / HALT_NEW**.
- **Ninguna API escribe la política.** Solo el archivo del host (RO) y `SIGHUP`/reinicio. Los `guards[]` de `accounts.json` siguen activos y solo pueden añadir restricciones.
- Registrar cada evaluación en `risk-decisions.jsonl` con `policyHash`, entradas y resultado por regla.

---

## 15. EXECUTION ENGINE

- Máquina de estados: `CREATED → RECORDED | RISK_MIRROR_OK/REJECTED → STAGED → COMMITTED → (AWAITING_APPROVAL) → PUSHING → SUBMITTED | REJECTED | UNKNOWN → PARTIALLY_FILLED → FILLED | CANCELLED | EXPIRED | NEEDS_HUMAN`.
- WAL: persistir la transición en `order_events` **antes** de cada llamada externa.
- `clientOrderId` determinístico por intent; sin reintentos de escritura; `UNKNOWN` → reconciliar (`getOrders`, `sync`, `order-history`) antes de cualquier otra acción; ambigüedad → `NEEDS_HUMAN` + `HALT_NEW` del símbolo.
- Una cola serializada por cuenta (TradingGit admite un solo commit pendiente). Solo cuentas `engineOwned`; si hay staging ajeno → alerta, sin tocar nada.
- Modo 4: intents con expiración → `reject(expectedPendingHash)` al caducar.

---

## 16. POSITION MONITOR

Bucle de 10–15 s: invariante P1 (toda posición gestionada tiene un stop vivo en el broker; si falta: recrear, y si no se puede: alerta crítica + cierre configurable); P2 (el stop solo se mueve a favor); trailing por barra cerrada; time stop; salidas por estrategia; fills parciales; reconciliación broker ↔ Engine en cada ciclo y al arrancar (no se decide nada hasta reconciliar).

---

## 17. MARKET DATA

Fuente primaria: UTA `POST /api/trading/uta/:id/historical` y `POST /api/trading/uta/:id/quote` de la cuenta o del UTA keyless del mismo venue. Verifica el formato de body y respuesta en `routes-trading.ts` y `BarParams`. Cachea en `market_bars` con `source`, `fetched_at` y hash del dataset; controles de calidad (huecos, duplicados, OHLC inválido, volumen 0); solo barras **cerradas**; `data_age_seconds` en cada snapshot; datos obsoletos más allá del umbral → no operar ese símbolo y avisar.

---

## 18. SCHEDULER

Reloj interno del Engine alineado a cierres de barra por intervalo (con margen de N s para que el venue publique la barra); ciclos no reentrantes por cuenta; jitter controlado; reloj inyectable (el backtest usa un reloj simulado). **No** uses los Issues de OpenAlice como reloj de trading (granularidad de ~60 s, arranque en frío de un CLI). Los Issues solo sirven para los roles LLM.

---

## 19. LOGGING

`pino` JSON (ya es dependencia del monorepo; verifica la versión) con campos `component`, `cycle_id`, `decision_id`, `intent_id`, `account_id`, `symbol`; redacción de secretos (tokens, apiKey, secret, password); niveles configurables. No cambies el logging de Alice ni de UTA más allá de lo necesario.

---

## 20. OBSERVABILITY

`GET /engine/health`, `GET /engine/ready`, `GET /engine/status`, `GET /engine/metrics` (formato Prometheus), `GET /engine/decisions/:id`, `GET /engine/why?symbol=&at=` que reconstruya: timestamp, activo, datos, régimen, estrategia, señal, confianza, entry, stop, target, tamaño, riesgo (espejo + veredicto de UTA), razón, advisory, orden, ejecución, resultado y PnL, enlazando con el commit de TradingGit y `risk-decisions.jsonl`. Heartbeat externo (dead-man's switch). Alertas por Telegram (chat distinto del de aprobaciones).

---

## 21. TESTING

- Unit (Vitest, estilo del repo `*.spec.ts`): cada regla de riesgo con casos límite (valores exactamente en el límite, datos faltantes, decimales); estrategias (pureza, determinismo, no-lookahead por truncado); sizing (redondeo a `lotSize/minQty`); máquina de estados (todas las transiciones válidas e inválidas).
- Property-based si añades una librería (justifícalo en un ADR); si no, tablas de casos exhaustivas.
- Integración: `pnpm test:integration:uta` + nuevos specs con `MockBroker` que prueben que **todas** las rutas de escritura (tool, HTTP push, one-shot, Telegram) pasan por el RiskEngine.
- E2E Engine↔UTA(Mock): entrada → stop → trailing → salida; reinicios; kill switch.
- Caos: matar el Engine con posición abierta; matar UTA durante un push; cortar la red; estado corrupto.
- Paridad: la misma serie de precios produce los mismos trades en backtest y en paper (Mock).
- Live-paper solo en la Fase 8, con `OPENALICE_UTA_LIVE_PAPER=1`, cuenta demo verificada y comprobación de cuenta plana incluso tras un fallo.

---

## 22. BACKTESTING

Event-driven con el mismo código de estrategia, régimen, sizing y espejo de riesgo; reloj simulado; fills conservadores (open de la barra siguiente ± slippage; LMT solo si cruza; si stop y target caen en la misma barra, gana el stop); comisiones por venue; funding no modelado → marcado explícito; walk-forward IS/OOS; registro de todas las variantes probadas; estabilidad ±20 %; holdout de un solo uso; `run_id` reproducible; métricas: total return, CAGR (≥ 1 año), win/loss rate, avg win/loss/trade, profit factor, expectancy (y en R), max drawdown, volatilidad, Sharpe, Sortino, exposure, nº de trades, fees, slippage, IC 95 % bootstrap de la expectativa.

---

## 23. PAPER TRADING

Cuenta `mock-simulator` **no efímera** + PriceFeeder del Engine que toma quotes reales del venue y llama a `POST /api/simulator/uta/:id/mark-price` (verifica el body en `routes-simulator.ts`); M10 activo (comisiones y slippage); camino completo Engine→UTA→RiskEngine→TradingGit.

---

## 24. TESTNET

Cuentas demo/testnet mediante los presets existentes (Bybit Demo recomendado para datos reales; OKX y Binance Demo; Hyperliquid Testnet; Alpaca paper; IBKR paper). Antes: catálogo S1–S14 aplicable de `docs/uta-live-testing.md`. Verifica que TP/SL llegan al venue, que los ids no se truncan, la cancelación por id, los fills parciales y el reduce-only.

---

## 25. LIVE TRADING

Solo en la Fase 11 y solo con autorización humana explícita en el chat y un ADR de promoción. Sub-cuenta dedicada; API key sin retiros con IP allowlist; `capitalCap` pequeño; `executionModeMax=HUMAN_APPROVAL` durante ≥ 2 semanas y luego `SEMI_AUTONOMOUS`. **Tú nunca cambias la política del host ni activas live por tu cuenta.**

---

## 26. SECURITY

Auth de UTA con scopes (M7); la ruta one-shot `wallet/place-order` requiere scope `approve` u `operator`; el Engine usa `engine`; Alice `read`, `stage` y `approve`; kill/reset `operator`; simulador `simulator` (desactivado fuera de paper/dev). Política y control RO desde el host. Contenedores separados en la Fase 10. Escaneo de secretos en pre-commit. `pnpm install --frozen-lockfile`. Nada de secretos en logs, fixtures ni PRs. Documenta el riesgo residual (un agente en el contenedor de Alice con el token de Alice).

---

## 27. ERROR HANDLING

Errores tipados (`BrokerError` existente para lo que venga de UTA; `EngineError{code, retryable, severity}` en el Engine); ninguna excepción no capturada en el ciclo (captura por ciclo, registra, marca el ciclo `FAILED` y sigue con el siguiente); errores de riesgo o de estado → fail-closed; mapeo HTTP coherente con `routes-trading.ts` (400/404/409/500/503).

---

## 28. RETRIES

Lecturas: backoff exponencial con jitter y presupuesto de tiempo. Escrituras: **0** reintentos automáticos → reconciliación. Reinicio de procesos: `RestartBackoff`. Ninguna "retry storm".

---

## 29. RATE LIMITS

Token bucket por cuenta en el Engine (configurable; por defecto conservador), además del limitador interno de CCXT (verifica `enableRateLimit` en la versión instalada; no lo desactives). Registrar `429`/rate-limit como error transitorio con backoff.

---

## 30. DEPLOYMENT

Fases 2–9: un host con `pnpm build` y `node scripts/guardian/prod.mjs` bajo systemd (`Restart=always`) + el Engine como servicio systemd. Fase 10: `deploy/compose.yaml` con contenedores `uta`, `engine`, `alice`, red interna, volúmenes `uta-home`, `engine-data` y `alice-home`, política y control RO desde el host, secrets por archivo, `restart: unless-stopped`, healthchecks, UI publicada solo en `127.0.0.1` (acceso por túnel SSH).

---

## 31. DOCKER

Crea `deploy/{uta,engine,alice}.Dockerfile` multi-stage (builder con pnpm y el lockfile congelado; runtime mínimo, usuario sin root, `NODE_ENV=production`). No existen Dockerfiles de producción en el repo; no reutilices los de `scripts/*-smoke/` salvo como referencia. El contenedor `alice` necesita los CLIs de agente y sus credenciales para los roles LLM (documenta cómo, sin secretos).

---

## 32. VPS

Documenta en `deploy/RUNBOOK.md`: tamaño mínimo, `chrony`, `ufw`, `fail2ban`, usuario no root, actualizaciones de seguridad, túnel SSH para la UI, rutas del host (`/etc/openalice/risk-policy.json`, `/run/openalice-control/`), backups cifrados (restic/borg) con restauración probada, y procedimientos de incidente (kill switch, flatten, restore, rotación de claves).

---

## 33. MONITORING

Healthchecks de contenedores; `/engine/ready`; métricas; heartbeat externo; alertas críticas (kill switch, P1, UNKNOWN/NEEDS_HUMAN, cuenta offline con posición, error de reconciliación, política inválida) y resumen diario.

---

## 34. KILL SWITCH

Estados `NORMAL | HALT_NEW | FLATTEN`; persistente; se activa por endpoint con scope `operator`, por la UI (vía el proxy de Alice), por Telegram `/halt` (extensión del Connector siguiendo `docs/connector-service.md`), por el archivo del host `${OPENALICE_CONTROL_DIR}/HALT` (RO) y automáticamente por R16, R17, R19, cuenta offline con posición, datos obsoletos, reconciliación fallida o desfase de reloj. El reset requiere `operator` + `reason`; un halt por pérdida diaria no se resetea antes del siguiente día salvo con `force` auditado. `FLATTEN` requiere confirmación.

---

## 35. ROLLBACK

Cada fase en su propia rama y PR; feature flags para cada modificación de UTA (desactivadas = comportamiento original); imágenes con tag fijo; rollback = tag anterior; migraciones SQL expand/contract (compatibles una versión hacia atrás); los nuevos archivos de estado de UTA son aditivos (si se borran, UTA arranca en `HALT_NEW`, no en `NORMAL`).

---

## 36. MIGRATIONS

Engine: `services/engine/migrations/NNNN_*.sql`, aplicadas al arrancar dentro de una transacción, idempotentes, registradas en `schema_migrations`. OpenAlice: si cambias un formato persistido **ya publicado** (p. ej. `accounts.json`), usa `src/migrations/` con spec y regenera el índice (`pnpm build:migration-index`); si solo añades archivos nuevos (`pending.json`, `_risk/*`), no hace falta migración: documéntalo.

---

## 37. ACCEPTANCE TESTS (por fase; ver la sección 38 para las reglas de avance)

- **F0:** `docs/trading-engine/AUDIT.md` con cada hallazgo de la §1 re-verificado (archivo:línea) o corregido; lista de discrepancias.
- **F1:** ADRs (proceso aparte, SQLite, auth UTA, política RO, modos, tools de lectura); `services/engine` compila y pasa typecheck y tests; `pnpm test` completo en verde.
- **F2:** descargar las mismas barras dos veces → mismo hash; tests de huecos, duplicados y barra abierta; frescura medida.
- **F3:** tests de pureza, no-lookahead y determinismo para A–E; indicadores y ADX dentro de una tolerancia de 1e-9 frente a referencias calculadas a mano; sizing redondea bien a `minQty`.
- **F4:** suite R0–R20 con casos límite; test que demuestra que las 4 rutas de escritura (tool, push HTTP, one-shot, Telegram/connector) pasan por el RiskEngine; política ausente → `HALT_NEW`; `modifyOrder` que agranda la posición → rechazado; kill switch persistente tras reinicio; auth: sin token → 401, scope insuficiente → 403.
- **F5:** E2E en Mock: señal → intent → stage/commit/push → fill → stop protector → trailing → salida → trade registrado; reinicio del Engine a mitad del ciclo sin duplicados; PriceFeeder funcionando.
- **F6:** walk-forward reproducible (mismo `run_id` → mismas métricas); test de paridad backtest vs paper; informe de métricas completo; gate automático calculado.
- **F7:** caos (kill -9 del Engine y de UTA durante el push, corte de red) → 0 duplicados; todo `UNKNOWN` resuelto o `NEEDS_HUMAN`; pendiente de TradingGit restaurado (M5); escritura atómica verificada.
- **F8:** S1–S14 del venue demo con la cuenta plana al final; gate §16.
- **F9:** cada alerta crítica disparada en un simulacro y recibida; `/why` reconstruye el 100 % de los trades de prueba; heartbeat externo detecta la caída del host.
- **F10:** 7 días continuos en el VPS en modo PAPER sin intervención; restore de backup probado; reinicio del host recupera todo.
- **F11:** gate §17 + ADR firmado por el humano.

---

## 38. DEFINITION OF DONE (de cada tarea)

Código + tests + typecheck del owner (`npx tsc --noEmit` en la raíz para `src/`; `pnpm -F <pkg> typecheck` para paquetes y servicios; `cd ui && npx tsc -b` si tocas la UI) + suite adecuada según la "Verification Ladder" de `AGENTS.md` + build (`pnpm build` o `pnpm build:server`) + docs del owner actualizadas en el mismo cambio + ADR si hay decisión + sin secretos + `CHANGELOG`/nota de la fase + informe al humano con evidencia (comandos ejecutados y resultado real; nunca "debería funcionar").

---

## REGLAS DE TRABAJO (OBLIGATORIAS)

**Antes de modificar:** `git fetch origin`, `git status -sb`, revisa el diff; lee la guía owner del subsistema (`docs/README.md`); inspecciona el código real; identifica los componentes existentes; no dupliques funcionalidad; no rompas APIs existentes (rutas HTTP, CLI `alice-uta`, tools, formatos persistidos); no reemplaces componentes innecesariamente.

**Antes de crear:** busca (`rg`) si ya existe algo equivalente; reutiliza primero, modifica segundo, crea desde cero solo cuando sea necesario, y justifícalo en el PR.

**Antes de borrar:** nunca elimines código funcional sin justificarlo y sin confirmación humana.

**Después de cada cambio:** ejecuta los tests aplicables (`pnpm test:changed`, `pnpm test:owner:uta`, `pnpm test:integration:uta`, `pnpm -F @traderalice/engine-service test`), el typecheck del owner y el build; revisa los errores; documenta el cambio. **Lint: el repo NO tiene linter configurado** (no hay script `lint`). No inventes `pnpm lint`; si quieres añadir uno, propónlo en un ADR y pide aprobación. Hasta entonces, el "lint" es el typecheck estricto más las convenciones de `AGENTS.md`.

**NO PERMITAS:** código ficticio o de relleno (`// TODO implement` en rutas críticas); APIs, endpoints, variables o funciones inventadas; credenciales hardcodeadas; secretos en git; órdenes reales durante el desarrollo; cambios destructivos sin confirmación; desactivar tests para que pasen; subir umbrales de gates después de ver resultados.

**Git:** rama por fase (`feat/engine-f<N>-<tema>`); PRs a la rama de integración de tu fork; commits pequeños; nunca force-push a ramas compartidas.

**Cuando algo falte o sea ambiguo:** escribe "NO ENCONTRADO EN EL REPOSITORIO", propone opciones con sus trade-offs y **pregunta** antes de decisiones irreversibles.

---

## IMPLEMENTACIÓN POR FASES (NO avanzar sin los acceptance tests de la fase anterior en verde)

| Fase | Nombre | Modo máximo permitido |
|---|---|---|
| 0 | Repository audit | — (sin cambios de código salvo docs) |
| 1 | Architecture | RESEARCH_ONLY |
| 2 | Market data | RESEARCH_ONLY |
| 3 | Strategy engine | SIGNAL_ONLY |
| 4 | Risk engine | SIGNAL_ONLY (tests con Mock) |
| 5 | Paper trading | PAPER (Mock) |
| 6 | Backtesting | PAPER |
| 7 | Execution engine | PAPER; HUMAN_APPROVAL/SEMI/FULL solo contra Mock |
| 8 | Testnet | Hasta FULLY_AUTOMATED **solo en cuentas demo/testnet** |
| 9 | Monitoring | igual que F8 |
| 10 | 24/7 deployment | PAPER/demo en el VPS |
| 11 | Live trading | Solo con autorización humana explícita; empieza en HUMAN_APPROVAL |

Al terminar cada fase, entrega: resumen, archivos tocados, comandos de verificación y su salida real, riesgos residuales y la propuesta para la siguiente fase. **Espera la aprobación humana antes de empezar la siguiente.**

---

## HUMAN OVERSIGHT — MODOS

`RESEARCH_ONLY (1) · SIGNAL_ONLY (2) · PAPER (3) · HUMAN_APPROVAL (4) · SEMI_AUTONOMOUS (5) · FULLY_AUTOMATED (6)`. Modo efectivo = mínimo entre: `ENGINE_MODE`, el `executionModeMax` de la política RO, el `mode_cap` de la estrategia y el modo de la cuenta. UTA aplica el techo (no solo el Engine). En el modo 5, el push automático solo ocurre si el intent está dentro de un "sobre automático" más estrecho que la política; si no, pasa a aprobación humana. Configurable sin recompilar; cada cambio de modo se registra.

---

## PRIMERA ACCIÓN

Empieza por la **Fase 0**: no modifiques código. Lee los documentos listados en la §1, re-verifica cada hallazgo, ejecuta `pnpm install` y `pnpm test:owner:uta` (y `pnpm test:integration:uta`) para establecer la línea base, y entrega `docs/trading-engine/AUDIT.md` con las etiquetas de evidencia. Después, detente y espera aprobación.
