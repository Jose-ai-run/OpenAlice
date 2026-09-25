# OpenAlice → Sistema de Trading Automatizado Experimental
## Auditoría técnica, diseño de arquitectura y Prompt Master para Claude Code

**Repositorio auditado:** `https://github.com/TraderAlice/OpenAlice`
**Commit auditado:** `0d4faa90c67d6c24685c7b40679bea5a5742a215` (merge PR #1631, `package.json` versión `0.94.1`, 2026-09-24)
**Satélite inspeccionado:** `TraderAlice/Auto-Quant-V2` @ `v0.9.34` (`52d63148…`), versión por defecto declarada en `src/workspaces/templates/auto-quant-v2/template.json`
**Fecha del análisis:** 2026-09-24

### Leyenda de evidencia

| Etiqueta | Significado |
|---|---|
| **[VERIFICADO EN REPOSITORIO]** | Leído directamente en el código fuente del commit indicado (se cita archivo). |
| **[DOCUMENTACIÓN]** | Afirmado en `README.md`, `AGENTS.md`, `docs/`, `safe/` o comentarios, sin verificar el comportamiento en ejecución. |
| **[INFERENCIA]** | Conclusión derivada de código/documentación, pero no ejecutada ni probada. |
| **[PROPUESTA]** | Diseño nuevo propuesto en este documento. No existe en el repositorio. |

> **Limitación del análisis.** El repositorio se inspeccionó estáticamente (lectura de código, docs y tests). No se ejecutó `pnpm install`, `pnpm dev` ni ningún test, y no se conectó ningún broker. Todo lo marcado como VERIFICADO significa "el código dice esto", no "lo vi funcionar". El repositorio cambia a diario (4.410 commits); Claude Code debe re-verificar cada ruta antes de tocarla.

---

# 1. EXECUTIVE SUMMARY

**Qué es OpenAlice realmente.** OpenAlice no es un bot de trading. Es un *orquestador local* que lanza agentes de código nativos (Claude Code, Codex, OpenCode, Pi, etc.) dentro de "Workspaces" (repos git con PTYs), les inyecta herramientas de mercado vía CLIs (`alice`, `alice-uta`, `traderhub`), y separa toda escritura de trading en un proceso aparte, **UTA (Unified Trading Account)**, con un flujo de aprobación tipo git (`stage → commit → push → sync`). [VERIFICADO EN REPOSITORIO: `AGENTS.md`, `docs/project-structure.md`, `services/uta/src/main.ts`]

**Nivel de autonomía actual.** Hoy un agente LLM puede, en una ejecución programada (Issue con `when: cron`), investigar el mercado, preparar (stage) y confirmar (commit) órdenes con una tesis en texto libre. La ejecución (`push`) exige aprobación humana en la Web UI o por Telegram, **salvo** que el operador active `agent.allowAiTrading = true`, en cuyo caso el propio LLM ejecuta. [VERIFICADO EN REPOSITORIO: `src/tool/trading.ts` L798–847, `src/core/config.ts` L249]

Lo que **no existe**: motor de estrategias determinístico, señales estructuradas, position sizing, límite de pérdida diaria, protección de drawdown, kill switch, monitor de posiciones, backtesting de estrategias a nivel de órdenes, idempotencia de órdenes ante caídas, ni despliegue Docker de producción.

**Tres hallazgos críticos que condicionan todo el diseño:**

1. **El "muro de aprobación" no está en UTA; está en la capa de herramientas de Alice.** El endpoint HTTP de UTA `POST /uta/:id/wallet/push` no tiene autenticación y escucha en `127.0.0.1:47333`; además existe `POST /uta/:id/wallet/place-order`, que hace stage→commit→push en una sola llamada. La autenticación web de Alice deja pasar cualquier petición desde loopback. Consecuencia [INFERENCIA]: cualquier proceso local —incluido un agente con shell dentro de un Workspace— puede ejecutar órdenes sin aprobación. La propia documentación de seguridad lo admite: la autorización Alice→UTA es "partial; full in v2" y la "per-trade approval at carrier" es "v2+". [VERIFICADO EN REPOSITORIO: `services/uta/src/http/routes-trading.ts` L502–531 y L594–607, `services/uta/src/main.ts` L172–176, `src/webui/plugin.ts` L215–235; DOCUMENTACIÓN: `safe/THREAT_MODEL.md` "Defense layers"]
2. **La IA puede, en principio, modificar sus propios límites.** Los guards y el interruptor `allowAiTrading` viven en `~/.openalice/data/config/accounts.json` y `agent.json`, archivos que el mismo usuario del sistema operativo (el que ejecuta los agentes) puede escribir, y la API de configuración de Alice acepta peticiones de loopback sin token. [VERIFICADO EN REPOSITORIO: `src/core/config.ts` L448–485, L550; INFERENCIA sobre el alcance del agente]
3. **Los guards existentes fallan "abiertos".** Un tipo de guard desconocido se omite con un warning; `max-position-size` permite la orden si no puede estimar su valor; los guards solo evalúan `placeOrder` (no `modifyOrder`); el `cooldown` vive en memoria y se pierde al reiniciar. [VERIFICADO EN REPOSITORIO: `services/uta/src/domain/trading/guards/*.ts`]

**Recomendación de arquitectura.** Núcleo **determinístico** + LLM **fuera del camino crítico**:

- Un **Risk Engine determinístico dentro de UTA**, en el único punto por el que pasan todas las escrituras (el dispatcher con guards que envuelve `TradingGit.push`), que falla cerrado, con política de solo lectura montada desde el host y kill switch persistente. [PROPUESTA]
- Un **Engine Service** nuevo (proceso aparte, supervisado) que ejecuta estrategias puras y backtesteables, dimensiona posiciones, registra cada decisión en SQLite y opera contra UTA como un cliente autenticado más. [PROPUESTA]
- Los LLM se quedan en tres roles asíncronos que reutilizan los Issues programados de OpenAlice: analista de contexto (con poder solo de veto o reducción), revisor de tesis y analista de rendimiento. **No** la cadena de 11 agentes. [PROPUESTA]

**Por qué no poner un LLM a decidir las órdenes:** una decisión de un LLM no se puede backtestear de forma honesta (el modelo conoce el periodo histórico por su entrenamiento, no es determinístico y cuesta tokens por barra). Sin backtest honesto no hay forma objetiva de pasar de etapa. [INFERENCIA]

**Sobre rentabilidad:** este documento no propone ni promete ninguna estrategia rentable. Propone una infraestructura para medir, con criterios objetivos y fijados de antemano, si alguna estrategia merece capital.

---

# 2. OPENALICE ARCHITECTURE

## 2.1 Stack tecnológico

| Área | Tecnología | Evidencia |
|---|---|---|
| Lenguaje | TypeScript estricto, ESM, target ES2023; imports con extensión `.js` | [VERIFICADO EN REPOSITORIO: `AGENTS.md` "Code Conventions", `tsconfig.json`] |
| Runtime | Node ≥ 22.19.0; Bun 1.4.0 como runtime alternativo de distribución (`.bun-version`, `#openalice/pty-backend`) | [VERIFICADO EN REPOSITORIO: `package.json` "engines", "imports"] |
| Monorepo | pnpm 11.7 workspaces + Turborepo | [VERIFICADO EN REPOSITORIO: `pnpm-workspace.yaml`, `turbo.json`] |
| HTTP | Hono + `@hono/node-server` | [VERIFICADO EN REPOSITORIO: `package.json`] |
| Validación | Zod (configs), TypeBox (parámetros de tools según AGENTS.md; en `src/tool/trading.ts` se usa `zod`) | [VERIFICADO EN REPOSITORIO] — discrepancia menor doc/código |
| Aritmética financiera | `decimal.js` | [VERIFICADO EN REPOSITORIO] |
| Tipos de trading | `@traderalice/ibkr` (port TS de la API TWS de IBKR) como fuente de verdad de Contract/Order/Execution | [VERIFICADO EN REPOSITORIO: `services/uta/src/domain/trading/README.md`] |
| Brokers | CCXT, Alpaca, IBKR (TWS), Longbridge, LeverUp (Monad), Mock | [VERIFICADO EN REPOSITORIO: `services/uta/src/domain/trading/brokers/registry.ts`] |
| Agentes / LLM | Claude Code, Codex, cursor-agent, agy, grok, omp, opencode, pi, shell (CLIs nativos; el bucle del modelo **no** está en OpenAlice) | [VERIFICADO EN REPOSITORIO: `src/workspaces/adapters/`, `AGENTS.md`] |
| MCP | `@modelcontextprotocol/sdk`; servidor MCP en `:47332` | [VERIFICADO EN REPOSITORIO: `.mcp.json`, `src/server/mcp.ts`] |
| UI | React + Vite (`ui/`), Electron (`apps/desktop/`) | [VERIFICADO EN REPOSITORIO] |
| Tests | Vitest (unit, integration, e2e, external, live-paper) | [VERIFICADO EN REPOSITORIO: `vitest*.config.ts`, 629 archivos `*.spec.ts`] |
| Lint | **NO ENCONTRADO EN EL REPOSITORIO** (sin script `lint`, sin ESLint/Biome/Prettier) | [VERIFICADO EN REPOSITORIO: `package.json` raíz, `ui/`, `services/`, `packages/`] |
| Persistencia | Archivos (JSON/JSONL/Markdown/git). **Sin base de datos** en el núcleo | [VERIFICADO EN REPOSITORIO: `AGENTS.md`: "Persisted state is file-backed rather than database-backed"] |
| Licencia | AGPL-3.0-only | [VERIFICADO EN REPOSITORIO: `package.json`, `LICENSE`] |

## 2.2 Topología de procesos

```text
Guardian (scripts/guardian/prod.mjs | dev.ts | apps/desktop/src/main.ts)
├── UTA            services/uta  → 127.0.0.1:47333 (hardcoded)   autoridad de trading
├── Alice          src/main.ts   → OPENALICE_BIND_HOST:47331      Workspaces, tools, API, UI
│   ├── MCP        :47332
│   ├── Workspace PTYs: claude / codex / … (agentes nativos)
│   ├── ToolCenter (market, news, analysis, inbox, puente UTA)
│   └── Schedule scanner (~60 s) → ejecuciones headless (máx. 8 globales)
└── Connector      services/connector → :47334 (opcional) Telegram/Discord/Slack/Feishu
```
[VERIFICADO EN REPOSITORIO: `docs/project-structure.md`, `scripts/guardian/shared.ts` L69, `services/uta/src/main.ts` L37 y L178–182, `src/workspaces/service.ts` L217, `src/workspaces/schedule/scanner.ts` L62]

## 2.3 Estructura del monorepo

| Ruta | Rol | Evidencia |
|---|---|---|
| `apps/desktop/` | Shell Electron (Guardian empaquetado, IPC, preload) | [VERIFICADO EN REPOSITORIO] |
| `packages/cli/` | CLI instalable `openalice` (up/run/server/relay/machine) | [VERIFICADO EN REPOSITORIO] |
| `packages/guardian-runtime/` | Locks single-writer, heartbeats, `RestartBackoff` | [VERIFICADO EN REPOSITORIO: `src/restart-backoff.ts`] |
| `packages/uta-protocol/` | Tipos y cliente HTTP compartidos Alice↔UTA (`UTAClient`, `IBroker`, presets de brokers) | [VERIFICADO EN REPOSITORIO] |
| `packages/ibkr/` | Protocolo TWS de IBKR | [VERIFICADO EN REPOSITORIO] |
| `packages/uta-broker-{ccxt,alpaca,ibkr,leverup,longbridge}/` | "Broker Packs": envoltorios que re-exportan el broker desde `services/uta/src/...` para distribución opcional | [VERIFICADO EN REPOSITORIO: `packages/uta-broker-ccxt/src/index.ts`] |
| `packages/opentypebb/` | Paquete privado de compatibilidad de datos (proveedores estilo OpenBB: yfinance, fmp, sec, fred…) | [VERIFICADO EN REPOSITORIO; DOCUMENTACIÓN: `docs/market-data-architecture.md`] |
| `packages/connector-protocol/` | Contratos del Connector | [VERIFICADO EN REPOSITORIO] |
| `services/uta/` | Proceso UTA | [VERIFICADO EN REPOSITORIO] |
| `services/connector/` | Proceso Connector (adapters: telegram, discord, slack, feishu) | [VERIFICADO EN REPOSITORIO] |
| `src/` | Proceso Alice | [VERIFICADO EN REPOSITORIO] |
| `ui/` | Renderer React | [VERIFICADO EN REPOSITORIO] |
| `default/skills/` | Skills distribuidas a los agentes (`alice-uta`, `self-scheduling`, `build-thesis`, …) | [VERIFICADO EN REPOSITORIO] |
| `safe/` | Modelo de amenazas y playbooks de seguridad | [VERIFICADO EN REPOSITORIO] |
| `scripts/guardian/` | Supervisores dev/prod | [VERIFICADO EN REPOSITORIO] |

## 2.4 Auditoría componente por componente

Formato: **Qué hace · Dónde/archivos · Dependencias · Interacción · Reutilizar · Modificar · Crear**.

### (1) Arquitectura general
- **Qué/dónde:** tres procesos bajo Guardian; Alice sin estado de broker; UTA dueño exclusivo de brokers y escrituras. [VERIFICADO EN REPOSITORIO: `docs/project-structure.md`, `AGENTS.md`]
- **Reglas del proyecto que condicionan cualquier cambio** [DOCUMENTACIÓN: `AGENTS.md`]: "Do not move broker state back into Alice"; "Do not grow a parallel workflow engine in `src/`"; "New agent-facing capabilities normally ship as Workspace templates, skills, or satellite repositories"; "UTA is optional… Startup, onboarding, and Chat must work in lite/read-only mode".
- **Reutilizar:** la separación Alice/UTA es la base correcta para un sistema de trading seguro.
- **Modificar:** endurecer la frontera Alice/UTA (autenticación y autorización).
- **Crear:** un proceso de motor de estrategias (fuera de `src/` para respetar la regla anterior). [PROPUESTA]

### (2) Stack → ver §2.1.

### (3) Monorepo → ver §2.3.

### (4) `apps/`
- Solo `apps/desktop/` (Electron). Irrelevante para un servidor 24/7; útil solo como cliente local. [VERIFICADO EN REPOSITORIO]
- **Reutilizar:** nada para el servidor. **Modificar/Crear:** nada.

### (5) `packages/` → ver §2.3. Reutilizar `uta-protocol` (cliente y tipos), `guardian-runtime` (`RestartBackoff`), `ibkr` (tipos Contract/Order).

### (6) `services/`
- `services/uta` (trading) y `services/connector` (notificaciones y chat). [VERIFICADO EN REPOSITORIO]
- **Crear:** `services/engine` (motor de estrategias) siguiendo el patrón del Connector: servicio opcional, loopback o red interna, supervisado con backoff. [PROPUESTA]

### (7) `src/` (Alice)
- `src/core/` (config, sealing, tool-center, event-log, tool-call-log, inbox), `src/domain/` (market-data, analysis, news, thinking), `src/tool/` (tools para agentes), `src/workspaces/` (lanzador, adaptadores, issues, schedule), `src/services/` (auth, uta-client, uta-supervisor, trading-mode, connector-client), `src/server/` (MCP, CLI gateway, trade-provenance), `src/webui/` (Hono, auth, proxy a UTA), `src/migrations/`. [VERIFICADO EN REPOSITORIO]
- **Modificar (mínimo):** proxy y cliente UTA para enviar credencial de servicio; opcionalmente una ruta nueva de solo lectura para observar el Engine. **No** meter el motor de estrategias aquí.

### (8) UTA — Unified Trading Account
- **Qué hace:** cada cuenta configurada es un `UnifiedTradingAccount` que encapsula un `IBroker`, un `TradingGit` (historial de operaciones) y un pipeline de guards. Maneja salud y reconexión, staging, commit, push, sync, historial de órdenes y operaciones, observación de órdenes externas y simulación de cambios de precio. [VERIFICADO EN REPOSITORIO: `services/uta/src/domain/trading/UnifiedTradingAccount.ts` (1.262 líneas)]
- **Archivos:** `UnifiedTradingAccount.ts`, `uta-manager.ts`, `git/TradingGit.ts`, `git-persistence.ts`, `guards/*`, `order-sync-poller.ts`, `snapshot/*`, `cost-basis.ts`, `order-history.ts`, `position-math.ts`, `fx-service.ts`, `contract-*.ts`, `http/routes-trading.ts`, `http/routes-simulator.ts`, `main.ts`.
- **Dependencias:** `@traderalice/uta-protocol`, `@traderalice/ibkr`, `decimal.js`, Hono, Zod; importa `@/core/config.js`, `@/core/event-log.js` y `@/core/tool-center.js` de `src/` vía alias. [VERIFICADO EN REPOSITORIO: `services/uta/src/main.ts` L15–35]
- **Interacción:** Alice → UTA por HTTP local (`UTAClient` en `packages/uta-protocol/src/client/UTAClient.ts`; adaptadores `src/services/uta-client/`). La UI llega vía el proxy BFF `/api/trading/*` (`src/webui/routes/trading-proxy.ts`).
- **Detalles verificados relevantes:**
  - Todas las escrituras pasan por `dispatcher` → `createGuardPipeline(dispatcher, broker, guards)` → `TradingGit.executeOperation`. **Es el único cuello de botella de escritura hacia el broker.** [VERIFICADO EN REPOSITORIO: `UnifiedTradingAccount.ts` L180–205]
  - Staging bloqueado mientras exista un commit pendiente: "A commit is awaiting approval. Push or reject it before staging more operations." → **un solo lote pendiente por cuenta**. [VERIFICADO EN REPOSITORIO: `git/TradingGit.ts` L77–91]
  - `push(expectedPendingHash)` exige el hash del commit pendiente (protege contra carreras). [VERIFICADO EN REPOSITORIO]
  - `readOnly` y `keyless` bloquean mutaciones en el dispatcher. [VERIFICADO EN REPOSITORIO: L558–563]
  - `closePosition` con cantidad vuelve a validar contra la posición real antes de enviar (evita cruzar a exposición opuesta). [VERIFICADO EN REPOSITORIO: L572–597]
  - Validación por tipo de orden en el staging: MKT/LMT/STP/STP LMT/TRAIL/TRAIL LIMIT. [VERIFICADO EN REPOSITORIO: L603–638]
  - Salud: umbrales degraded=3 / offline=6 fallos; recuperación con backoff exponencial de 5 s a 60 s; push bloqueado si offline. [VERIFICADO EN REPOSITORIO: L100–103, L474–505, L793–803]
- **Reutilizar:** todo el flujo stage/commit/push/sync, salud y reconexión, historiales, snapshots, validaciones.
- **Modificar:** insertar el Risk Engine en el pipeline; persistencia atómica; autenticación; soporte de `clientOrderId`/`orderRef`; aplicar reglas también a `modifyOrder`.
- **Crear:** Risk Engine, kill switch, estado de riesgo persistente, log de decisiones de riesgo.

### (9) Integraciones con brokers
- **Registro:** `mock` integrado; `ccxt`, `alpaca`, `ibkr`, `leverup`, `longbridge` como Broker Packs cargados desde `<OPENALICE_HOME>/runtime/broker-packs/` (en dev/test, desde el workspace). [VERIFICADO EN REPOSITORIO: `brokers/registry.ts`]
- **Presets con entorno no-real** [VERIFICADO EN REPOSITORIO: `packages/uta-protocol/src/brokers/preset-catalog.ts`]:
  - Binance: `live | demo` (Demo Trading). El comentario explica que el testnet de futuros está muerto en CCXT 4.5.38.
  - OKX: `live | demo` (`sandbox`).
  - Bybit: `live | testnet | demo` (testnet = datos falsos; demo = datos reales con matching simulado).
  - Hyperliquid: `live | testnet`.
  - Bitget, CCXT custom (campos `sandbox`/`demoTrading`), Alpaca (paper por defecto), IBKR TWS/Gateway, Longbridge, LeverUp, `mock-simulator`.
- **TP/SL adjunto:** `placeOrder(contract, order, tpsl?)`; CCXT usa `params.takeProfit/stopLoss` o un override específico por venue; algunos venues requieren rutas especiales. [VERIFICADO EN REPOSITORIO: `brokers/ccxt/CcxtBroker.ts` L524–625]
- **Cierre de derivados con `reduceOnly: true`.** [VERIFICADO EN REPOSITORIO: `CcxtBroker.ts` L740]
- **IDs de cliente/idempotencia:** búsqueda de `clientOrderId|clOrdId|orderLinkId|newClientOrderId` en `services/uta/src/domain/trading` → **NO ENCONTRADO EN EL REPOSITORIO**.
- **Rate limits:** no hay limitador propio en UTA (**NO ENCONTRADO EN EL REPOSITORIO**). CCXT trae su propio limitador activado por defecto [INFERENCIA basada en el comportamiento de la librería; verificar en la versión instalada].
- **Reintentos:** `fetchMarkets` en init tiene reintentos (`MAX_INIT_RETRIES`); no hay reintentos en `placeOrder` (correcto: reintentar una orden no idempotente puede duplicarla). [VERIFICADO EN REPOSITORIO: `CcxtBroker.ts` L377]
- **Reutilizar:** todos los brokers. **Modificar:** propagar un id de cliente idempotente por broker (verificando el soporte de cada venue). **Crear:** nada.

### (10) Sistema de agentes
- **Qué hace:** OpenAlice **no** tiene bucle de agente propio. Lanza CLIs nativos como procesos PTY (interactivos) o headless (para Issues), con credenciales y modelo inyectados por Workspace/Session. [VERIFICADO EN REPOSITORIO: `src/workspaces/adapters/`, `docs/model-semantics-and-runtime-injection.md`]
- **Salida estructurada normalizada** de cada ejecución headless (`assistantText`, bloques text/tool/error). [DOCUMENTACIÓN: `docs/workspace-issues-and-scheduling.md` "Structured Runtime Output"]
- **Multi-agente:** varios Workspaces/Sessions, delegación (skill `delegate-autoquant`), Issues asignados a Sessions concretas (`@resumeId`). No existe un orquestador jerárquico con paso de mensajes tipado. [VERIFICADO EN REPOSITORIO: `default/skills/`, `src/workspaces/issues/`]
- **Reutilizar:** Issues programados como "trabajos LLM" asíncronos (análisis, revisión, informes). **Modificar:** nada en el núcleo. **Crear:** una plantilla de Workspace o un set de skills "Trading Desk" con los prompts de los roles LLM. [PROPUESTA]

### (11) Tools
- **Registro:** `src/core/tool-center.ts`; alcance por Workspace en `src/core/workspace-tool-center.ts`. Los agentes llaman a las tools vía shims en PATH (`src/workspaces/cli/bin/alice`, `alice-uta`, `traderhub`) y el gateway `/cli`. [VERIFICADO EN REPOSITORIO]
- **Tools de trading** (`src/tool/trading.ts`): `listUTAs`, `searchContracts`, `getContractDetails`, `getAccount`, `getPortfolio`, `getOrders`, opciones, order book, `getQuote`, `expandContract`, `getMarketClock`, `tradingLog`, `tradingShow`, `tradingStatus`, `simulatePriceChange`, `placeOrder`/`modifyOrder`/`closePosition`/`cancelOrder` (solo stage, con commit opcional), `tradingCommit`, `tradingPush` (bloqueado salvo `allowAiTrading`), `tradingReject`, `orderHistory`, `tradeHistory`, `tradingSync`. [VERIFICADO EN REPOSITORIO]
- **Tools de análisis:** indicadores (`src/domain/analysis/indicator/functions/`: RSI, BBANDS, MACD, ATR, RVOL, OBV, MFI, VWAP, SMA, EMA, STDEV, ROC, ZSCORE, SLOPE, CORRELATION, HIGHEST, LOWEST, …), `snapshot` (as-of sin lookahead, con contrato de frescura), `simulate` (backtest de 1 entrada + 1 regla de salida), `quant` (scripts sobre K-lines), `sector-rotation`, `news`, `economy`, `equity`, `etf`. [VERIFICADO EN REPOSITORIO: `src/tool/*.ts`, `src/domain/analysis/*`]
- **Reutilizar:** indicadores (el Engine puede importarlos vía alias `@/`, igual que UTA ya importa `@/core/*`). **Modificar:** nada. **Crear:** helpers de series (las funciones de indicadores devuelven el último valor, `number`) dentro del Engine. [VERIFICADO EN REPOSITORIO: firma `RSI(data, period): number`]

### (12) Workspaces
- **Qué hace:** directorio + repo git + PTYs + scrollback + issues + schedules + configuración del agente; plantillas `chat`, `auto-quant-v2` (satélite fijado), `auto-prediction` (satélite). [VERIFICADO EN REPOSITORIO: `src/workspaces/templates/*/template.json`, `docs/project-structure.md`]
- **Reutilizar:** un Workspace "trading-desk" para los roles LLM; los archivos del Workspace funcionan como memoria auditable de la investigación.
- **Crear:** skills específicas del desk (prompts de roles, formato JSON del contexto de investigación). [PROPUESTA]

### (13) Scheduled Issues / tareas programadas
- **Qué hace:** un Issue es `<workspace>/.alice/issues/<id>.md` con frontmatter; `when` admite `at | every | cron (+timezone, catchUp)`. Un scanner (~60 s) lanza una ejecución headless del agente; el resultado va al Inbox vía `inbox_push`. Controles de `timeout`, "Retry now" y "Run now", y proyección `automationHealth` (`healthy/failed/blocked/interrupted`…). Máximo 8 ejecuciones headless simultáneas; sin lock exclusivo por Workspace. [VERIFICADO EN REPOSITORIO: `src/workspaces/schedule/scanner.ts`, `src/workspaces/service.ts` L217; DOCUMENTACIÓN: `docs/workspace-issues-and-scheduling.md`]
- **Limitación:** "Cron is not an exchange calendar: holidays, early closes… remain business conditions". [DOCUMENTACIÓN]
- **Reutilizar:** para los roles LLM (informe pre-mercado, contexto de régimen, revisión diaria de rendimiento). **No usar** como reloj del motor de trading: granularidad de ~60 s, arranque en frío de un CLI y sin determinismo. [INFERENCIA]

### (14) Trading as Git
- **Qué hace:** `stage` (placeOrder/modifyOrder/closePosition/cancelOrder) → `commit(message)` (hash de 8 caracteres, mensaje = tesis) → `push(expectedPendingHash)` (ejecución; solo devuelve submitted/rejected) → `sync` (confirma filled/cancelled). También `reject`, `log`, `show`, `status`, commits `[observed]` para órdenes externas y reconciliación. [VERIFICADO EN REPOSITORIO: `git/TradingGit.ts`; DOCUMENTACIÓN: `services/uta/src/domain/trading/README.md`]
- **Persistencia:** solo `commits` + `head` en `data/trading/<accountId>/commit.json`. **El staging y el commit pendiente viven en memoria** → se pierden si UTA se reinicia. [VERIFICADO EN REPOSITORIO: `TradingGit.exportState()` L565–571]
- **Escritura no atómica:** `writeFile` directo, sin tmp + rename. [VERIFICADO EN REPOSITORIO: `git-persistence.ts`]
- **Orden de persistencia:** el commit se escribe *después* de ejecutar en el broker. Si el proceso muere entre ambos pasos, la orden existe en el broker y no en el ledger (el observador de órdenes externas la registraría más tarde como `[observed]`). [VERIFICADO EN REPOSITORIO: `executePush` L129–185; INFERENCIA sobre la recuperación]
- **Reutilizar:** como *ledger de acciones sobre el broker* y como identidad de la decisión (hash). **Modificar:** escritura atómica, persistir el pendiente, id de cliente. **Crear:** un journal write-ahead en el Engine (§12).

### (15) Mecanismos de aprobación
- **Web UI** (página Trading as Git y detalle de cuenta), **Telegram** (`/uta` con Approve/Reject a través del Connector → Alice → UTA, con `pendingHash` obligatorio), y la tool `tradingPush` para la IA si `allowAiTrading`. [VERIFICADO EN REPOSITORIO: `src/services/connector-client/uta-review.ts` L190–206; DOCUMENTACIÓN: `docs/connector-service.md` L160–168]
- **Modos de producto:** `trading.mode = lite | readonly | pro` (env `OPENALICE_TRADING_MODE` tiene prioridad), `readOnly` por cuenta y `agent.allowAiTrading`. [VERIFICADO EN REPOSITORIO: `src/services/trading-mode.ts`, `src/core/config.ts`]
- **Discrepancia código/comentario:** `routes-trading.ts` L502 dice "the AI tool is hollowed out, only humans can push", pero `src/tool/trading.ts` permite que la IA haga push si `allowAiTrading=true`. El código manda: la IA **sí** puede hacer push con el interruptor activo. [VERIFICADO EN REPOSITORIO]
- **Reutilizar:** aprobación por UI y Telegram para el modo 4. **Modificar:** que el modo de ejecución se aplique dentro de UTA y no solo en la tool.

### (16) Risk guards
- **Existentes:** `max-position-size` (% del equity; 25 % por defecto), `cooldown` (60 s por símbolo, en memoria), `symbol-whitelist`. Registro extensible con `registerGuard`. Configuración por cuenta en `accounts.json` → `guards[]`. UI en `ui/src/components/guards.tsx`. [VERIFICADO EN REPOSITORIO]
- **Defectos verificados:**
  - Solo actúan sobre `placeOrder` (`max-position-size` y `cooldown` devuelven `null` para otras acciones) → `modifyOrder` puede aumentar la cantidad sin control.
  - `max-position-size`: "If we can't estimate… allow — broker will validate" → falla abierto con órdenes por cantidad en símbolos nuevos.
  - `cooldown` registra el timestamp aunque un guard posterior rechace, y se pierde al reiniciar.
  - `resolveGuards` omite tipos desconocidos con `console.warn` → un error tipográfico desactiva el guard en silencio.
  - Obtiene posiciones y cuenta en cada operación, sin comprobar frescura de precio ni quote.
- **Reutilizar:** la interfaz `OperationGuard` y el pipeline. **Modificar:** fail-closed, persistencia, cobertura de `modifyOrder`. **Crear:** Risk Engine completo (§11).

### (17) Gestión de posiciones
- Lectura de posiciones (`getPositions`), coste base reconstruido desde los commits (`cost-basis.ts`), `position-math.ts`, simulación de cambios de precio. **No hay** monitor que gestione stops, trailing, time-stops ni cierres por regla. [VERIFICADO EN REPOSITORIO] → **Crear:** Position Monitor en el Engine.

### (18) Gestión de órdenes
- Staging validado; `order-sync-poller` cada 10 s para órdenes pendientes (listado de abiertas si el broker lo soporta; si no, polling con backoff por antigüedad); observación de órdenes externas cada 15 min (configurable). [VERIFICADO EN REPOSITORIO: `order-sync-poller.ts`, `UnifiedTradingAccount.sync()`]
- **Reutilizar:** todo. **Crear:** la máquina de estados de intenciones de orden y la reconciliación en el Engine.

### (19) Gestión de cuentas
- `accounts.json` (array `utaConfigSchema`: `id, presetId, enabled, guards, presetConfig, ephemeral, keyless, readOnly, asVendor, editable`), credenciales selladas (AES-256-GCM, `sealing.key` fuera de `data/`), reinicio de UTA por flag `data/control/restart-uta.flag`. Sub-cuentas (wallets) con desambiguación en la escritura. [VERIFICADO EN REPOSITORIO: `src/core/config.ts`, `src/core/sealing.ts`, `src/services/uta-supervisor/restart-trigger.ts`]
- La documentación de sellado admite: "same-user malware or a compromised Alice process can read the key file… The structural answer to that is the detached-UTA split". [DOCUMENTACIÓN: comentario en `src/core/sealing.ts`]
- **Reutilizar:** todo. **Recomendación:** una cuenta/sub-cuenta y una API key **dedicadas al Engine**, porque el staging es por cuenta y compartirlo con agentes produce conflictos. [INFERENCIA desde TradingGit]

### (20) Market data
- Tres capas: TraderHub/datos de referencia (`traderhub` CLI, hub alojado `traderhub.openalice.ai` con fallback local), BarService (K-lines por `barId`, federando vendors y brokers vía UTA) y el paquete de compatibilidad `opentypebb` (yfinance por defecto; fmp, sec, fred, eia, cboe, deribit, …). [VERIFICADO EN REPOSITORIO: `src/domain/market-data/`, `packages/opentypebb/src/providers/`; DOCUMENTACIÓN: `docs/market-data-architecture.md`]
- UTA expone `POST /uta/:id/historical` (intervalos `1m…1w`) y `POST /uta/:id/quote` (last/bid/ask/volume/timestamp). [VERIFICADO EN REPOSITORIO: `routes-trading.ts` L318–395, `uta-protocol/src/types/broker.ts` L304–347]
- Fuentes keyless públicas (binance/okx/bybit) como UTAs de solo datos. [VERIFICADO EN REPOSITORIO: `config.ts` L384–410]
- **Streaming (WebSocket) de precios:** solo aparece en el broker Longbridge; no hay feed de ticks unificado. [VERIFICADO EN REPOSITORIO: grep `watchTicker|WebSocket`]
- Aviso: yfinance "end-of-day bars can lag a day or two". [VERIFICADO EN REPOSITORIO: descripción en `src/tool/analysis.ts`]
- **Reutilizar:** barras y quotes del venue a través de UTA (mismo venue que se opera). **Crear:** caché local de barras con procedencia, controles de calidad y frescura en el Engine.

### (21) Backtesting
- **En OpenAlice:** solo `simulate` (una entrada + una regla de salida: trailing_stop, ma_break, stop, target, hold; sin comisiones ni slippage). [VERIFICADO EN REPOSITORIO: `src/domain/analysis/simulate.ts`]
- **En AutoQuant V2 (satélite Python):** laboratorios de factores, carteras, RL, riesgo de libro, eventos y asignación, con costes lineales y disciplina de validación/holdout. Es investigación a nivel cartera/factor, no un backtester de órdenes conectado a UTA. [DOCUMENTACIÓN: `Auto-Quant-V2/docs/STATUS.md`]
- **Discrepancia:** el `STATUS.md` de AutoQuant (2026-08-22) dice que OpenAlice sigue fijado a `v0.8.31`, pero `template.json` de OpenAlice declara `defaultVersion: v0.9.34`. Manda el código de OpenAlice. [VERIFICADO EN REPOSITORIO]
- **Crear:** backtester de eventos en el Engine que use exactamente el mismo código de estrategia que paper/live.

### (22) Paper trading
- **Vía broker:** Alpaca paper, cuentas demo de Binance/OKX/Bybit e IBKR paper (TWS). Requiere claves del entorno correspondiente. [VERIFICADO EN REPOSITORIO: presets]
- **Vía simulador interno:** `MockBroker`, un exchange en memoria completo (MKT se llena al `markPrice`; LMT/STP se llenan al tocar precio o a mano), controlado por `/api/simulator/*` (mark-price, tick-price, fill, cancel, depósitos y trades externos). **Sin comisiones ni slippage, sin feed de precios en vivo, sin TRAIL.** [VERIFICADO EN REPOSITORIO: `brokers/mock/MockBroker.ts`, `http/routes-simulator.ts`]

### (23) Testnet/sandbox → Bybit testnet, Hyperliquid testnet y modos demo (ver 9). Carril `pnpm test:live:*-paper` con `OPENALICE_UTA_LIVE_PAPER=1` y catálogo de escenarios S1–S14. [VERIFICADO EN REPOSITORIO: `package.json`; DOCUMENTACIÓN: `docs/uta-live-testing.md`]

### (24) Persistencia
| Dato | Ubicación | Formato |
|---|---|---|
| Config | `<OPENALICE_HOME>/data/config/*.json` (`accounts.json`, `agent.json`, `trading.json`, `market-data.json`, `snapshot.json`, …) | JSON (credenciales selladas) |
| Ledger de trading | `data/trading/<id>/commit.json` | JSON (reescritura completa) |
| Snapshots de cuenta | `data/trading/<id>/…/chunk-NNNN.jsonl` | JSONL |
| Event log UTA | `data/event-log/events.jsonl` | JSONL + ring buffer |
| Tool calls | `data/tool-calls/tool-calls.jsonl` | JSONL |
| Issues | `<workspace>/.alice/issues/*.md` + `.comments.json` | Markdown + JSON |
| Runs/provenance | `workspaces/state/…` | JSON/JSONL |

[VERIFICADO EN REPOSITORIO: `docs/project-structure.md` "Persistent State", `snapshot/store.ts`, `core/event-log.ts`, `core/tool-call-log.ts`]

### (25) Bases de datos → **NO ENCONTRADO EN EL REPOSITORIO** para el núcleo (Auto Prediction usa SQLite propio [DOCUMENTACIÓN]). El Engine necesitará una (§18).

### (26) Configuración por variables de entorno (seleccionadas, verificadas en código)
`OPENALICE_HOME`, `OPENALICE_APP_HOME`, `OPENALICE_GLOBAL_DIR`, `AQ_LAUNCHER_ROOT`, `OPENALICE_BIND_HOST`, `OPENALICE_WEB_PORT`, `OPENALICE_MCP_PORT`, `OPENALICE_UTA_PORT`, `OPENALICE_UTA_URL`, `OPENALICE_CONNECTOR_PORT`, `OPENALICE_TRADING_MODE`, `OPENALICE_LITE_MODE`, `OPENALICE_UTA_DISABLED`, `OPENALICE_DISABLE_AUTH`, `OPENALICE_TRUSTED_PROXIES`, `OPENALICE_CSRF_TRUSTED_ORIGINS`, `OPENALICE_PUBLIC_URL`, `OPENALICE_LAUNCHER`, `OPENALICE_BROKER_PACK_*`, `OPENALICE_UTA_LIVE_PAPER` (tests), `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY`. [VERIFICADO EN REPOSITORIO: grep de `process.env` y `env[...]`]
- `OPENALICE_UTA_BIND_HOST`: **NO ENCONTRADO EN EL REPOSITORIO** (el host está fijo en `127.0.0.1`).

### (27) Secrets
- Claves de brokers selladas en disco; claves de proveedores de IA en `provider-keys.json` (global); token de admin en `data/config/auth.json`; `spawn-env.ts` elimina algunas variables (`OPENALICE_MCP_URL`, `OPENALICE_TOOL_URL`, …) del entorno de los PTYs. [VERIFICADO EN REPOSITORIO]
- **Gestor de secretos externo (Vault/Docker secrets):** **NO ENCONTRADO EN EL REPOSITORIO**.

### (28) Autenticación
- Alice: token de admin + cookie de sesión, CSRF, proxies de confianza; **bypass para loopback** cuando no hay proxy de confianza; se niega a arrancar en bind público sin token. [VERIFICADO EN REPOSITORIO: `src/webui/plugin.ts`, `src/webui/middleware/auth.ts`]
- UTA: **sin autenticación**, solo bind a `127.0.0.1`. [VERIFICADO EN REPOSITORIO]

### (29) Logs
- `console.*` en los procesos principales; `pino` está en dependencias pero no hay sink universal ("the main process currently uses `console` and has no universal pino sink"). Logs estructurados en el lanzador de Workspaces; journals JSONL (event-log, tool-calls, agent-runtime). [VERIFICADO EN REPOSITORIO; DOCUMENTACIÓN: `AGENTS.md`]

### (30) Monitoring
- `GET /__uta/health`, salud por cuenta (`getHealthInfo`), `automationHealth` de Issues, snapshots periódicos. **Métricas, alertas y dashboards de riesgo/PnL: NO ENCONTRADO EN EL REPOSITORIO.**

### (31) Error handling
- `BrokerError` con `code` y `permanent` (permanente → cuenta deshabilitada; transitorio → recuperación); mapeo HTTP 503/500; lecturas durante la conexión inicial devuelven `CONNECTING` en vez de bloquear. [VERIFICADO EN REPOSITORIO: `UnifiedTradingAccount.ts`, `routes-trading.ts` L98–128]

### (32) Retry mechanisms
- Recuperación de cuenta (5 s→60 s), reintentos de `fetchMarkets`, `RestartBackoff` para el Connector (1 s→60 s con jitter), "Retry now" manual para Issues ("no automatic retry storm"). **Sin reintentos de órdenes** (correcto por diseño). [VERIFICADO EN REPOSITORIO]

### (33) Rate limits → no hay limitador propio en UTA ni en el envío de órdenes (**NO ENCONTRADO EN EL REPOSITORIO**); en auth, el modelo de amenazas lo sitúa en el alcance [DOCUMENTACIÓN: `safe/THREAT_MODEL.md`].

### (34) Concurrency
- Guard de re-entrada en el poller; `inflightWrite` en TradingGit; bloqueo de staging con commit pendiente; máximo 8 headless; locks single-writer de Guardian (`guardian.lock`, `runtime.lock`); sin lock por Workspace. [VERIFICADO EN REPOSITORIO]

### (35) Scheduling
- Scanner de Issues (60 s), order-sync (10 s), observación de órdenes externas (15 min), snapshots (`snapshot.every`), refresco de catálogo (6 h). El bus de eventos y scheduler antiguo de Alice fue **retirado**. [VERIFICADO EN REPOSITORIO; DOCUMENTACIÓN: `docs/event-system.md`]

### (36) Docker
- **Dockerfile/compose de producción: NO ENCONTRADO EN EL REPOSITORIO.** Solo hay Dockerfiles de *smoke tests* (`scripts/install-smoke/`, `scripts/remote-smoke/`, `scripts/install-channel-smoke/`). `prod.mjs` acepta `OPENALICE_LAUNCHER=docker` y la documentación dice que "Docker is updated by its service/deployment owner". [VERIFICADO EN REPOSITORIO; DOCUMENTACIÓN: `docs/cli-installer.md` L385]

### (37) Deploy
- Instalador nativo (`install`, `install.ps1`), CLI `openalice up|run|server`, flujo remoto por SSH (`docs/remote-access.md`), Electron. [VERIFICADO EN REPOSITORIO]
- **Comportamiento de reinicio en prod** [VERIFICADO EN REPOSITORIO: `scripts/guardian/prod.mjs` L310–392]:
  - Si **UTA** muere inesperadamente: se marca offline y **no se reinicia** ("trading offline, Alice stays up"); solo se reinicia mediante el flag de configuración.
  - Si **Connector** muere: se reinicia con `RestartBackoff`.
  - Si **Alice** muere: Guardian entero hace shutdown → hace falta un supervisor externo (systemd o política `restart` de Docker).

### (38) CI/CD
- GitHub Actions: `ci.yml` (source-contracts, workspace-build, hermetic-tests, cross-platform-test, dev-smoke con recuperación de Guardian) y workflows de release/desktop/CLI. [VERIFICADO EN REPOSITORIO: `.github/workflows/`]

### (39) Tests
- 629 archivos `*.spec.ts`. Carriles: hermetic (`pnpm test`), `test:changed`, `test:owner:*`, `test:integration` (+ `:uta` con MockBroker), `test:system:*`, `test:external:readonly`, `test:live:*-paper` (requiere `OPENALICE_UTA_LIVE_PAPER=1`). Specs relevantes: `TradingGit.spec.ts` (1.132 líneas), `UnifiedTradingAccount.spec.ts` (1.577), `guards.spec.ts`, `order-sync-poller.spec.ts`, `uta-health.spec.ts`. [VERIFICADO EN REPOSITORIO]

### (40) Seguridad
- Modelo de amenazas explícito (`safe/`), sellado de credenciales, bind a localhost por defecto, CSRF, rechazo de bind público sin token. Capas pendientes según su propia documentación: "L3 Authorization — limits on what Alice can ask UTA (partial; full in v2)", "L4 Carrier Isolation — UTA on separate device (v2+)", "L5 Pre-execution ceremony — per-trade approval at carrier (v2+)". [DOCUMENTACIÓN: `safe/THREAT_MODEL.md`]
- Fuera de alcance declarado: "Root on the host… shell access… Game over by definition". Un agente de código con shell corre como ese mismo usuario. [DOCUMENTACIÓN + INFERENCIA]

## 2.5 Discrepancias README/documentación vs código

| # | Afirmación | Realidad en código | Referencia |
|---|---|---|---|
| D1 | README: "You review and approve execution through Trading as Git" | La IA puede hacer push con `allowAiTrading=true`; el endpoint one-shot `wallet/place-order` ejecuta sin paso de aprobación; UTA no autentica | `src/tool/trading.ts`, `routes-trading.ts` |
| D2 | Comentario: "the AI tool is hollowed out, only humans can push" | Falso desde que existe `allowAiTrading` | `routes-trading.ts` L502 |
| D3 | AGENTS.md: "TypeBox for tool parameter schemas" | `trading.ts` usa `zod` en `inputSchema` | `src/tool/trading.ts` |
| D4 | AutoQuant STATUS: OpenAlice fijado a v0.8.31 | `template.json` declara `defaultVersion: v0.9.34` | `src/workspaces/templates/auto-quant-v2/template.json` |
| D5 | Docs hablan de un launcher "docker" | No hay Dockerfile de producción | `scripts/guardian/prod.mjs` L90 |
| D6 | "Live trading" presentado como feature | README: "Trading execution is beta… no guarantees of correctness" | `README.md` |

---

# 3. CURRENT CAPABILITIES

Escala: **A** = existe y funciona · **B** = existe parcialmente · **C** = requiere configuración externa · **D** = requiere desarrollo · **E** = no existe.
("Funciona" significa que el código lo implementa y tiene tests; no se ejecutó.)

| Capacidad | Clase | Qué existe exactamente | Evidencia |
|---|---|---|---|
| Análisis automático de mercado | **B** | Un Issue programado ejecuta un LLM con tools (barras, snapshot, indicadores, noticias, fundamentales). No es sistemático ni reproducible | [VERIFICADO EN REPOSITORIO] `schedule/scanner.ts`, `src/tool/*` |
| Generación de señales | **D** | No hay objeto "señal" ni motor; el LLM "decide" en texto | [VERIFICADO EN REPOSITORIO] (ausencia) |
| Generación de tesis | **B** | Skill `build-thesis`; el mensaje del commit guarda la tesis en texto libre | [VERIFICADO EN REPOSITORIO] `default/skills/build-thesis`, `TradingGit.commit` |
| Ejecución automática | **B** | `tradingPush` ejecuta si `allowAiTrading=true`, siempre disparado por un LLM | [VERIFICADO EN REPOSITORIO] `src/tool/trading.ts` L824–845 |
| Ejecución con aprobación humana | **A** (Telegram: **C**) | UI Trading as Git; Telegram `/uta` Approve/Reject si el Connector está configurado | [VERIFICADO EN REPOSITORIO] `uta-review.ts` |
| Ejecución sin aprobación humana | **C** | Activando `agent.allowAiTrading` (con doble confirmación en la UI) | [VERIFICADO EN REPOSITORIO] `config.ts` L249, i18n |
| Gestión automática de posiciones | **E** | Solo sync de estado de órdenes | [VERIFICADO EN REPOSITORIO] |
| Stop loss automático | **B** | Tipos STP / STP LMT y `stopLoss` adjunto en `placeOrder` (según broker); sin gestión por el sistema | [VERIFICADO EN REPOSITORIO] `UnifiedTradingAccount.ts` L693–725, `CcxtBroker.ts` |
| Take profit automático | **B** | `takeProfit` adjunto (según broker) o orden LMT | idem |
| Trailing stop | **B** | TRAIL / TRAIL LIMIT validados en staging; soporte según broker (`MockBroker` no lo soporta) | [VERIFICADO EN REPOSITORIO] L628–636, `MockBroker.ts` L106 |
| Position sizing | **E** | Solo el límite `max-position-size` (un tope, no un dimensionador). AutoQuant tiene "one-leg cash sizing" de investigación | [VERIFICADO EN REPOSITORIO]; [DOCUMENTACIÓN] AQ |
| Portfolio allocation | **E** (núcleo) / **B** (AQ, investigación) | `ohlcv-allocation-lab` en AutoQuant, sin conexión a ejecución | [DOCUMENTACIÓN] AQ STATUS |
| Risk management | **B** | 3 guards con defectos (§2.4-16) | [VERIFICADO EN REPOSITORIO] |
| Daily loss limit | **E** | — | grep `dailyLoss|drawdown` sin resultados |
| Max drawdown protection | **E** | — | idem |
| Kill switch | **E** | Sustitutos manuales: `trading.mode=readonly`, `readOnly` por cuenta, desactivar `allowAiTrading`. No reduce-only, sin disparadores automáticos | [VERIFICADO EN REPOSITORIO] |
| Paper trading | **C** (brokers demo) / **B** (MockBroker) | Demo/paper por preset; MockBroker sin feed, comisiones ni slippage | [VERIFICADO EN REPOSITORIO] |
| Testnet | **C** | Bybit/Hyperliquid testnet, OKX/Binance/Bybit demo | [VERIFICADO EN REPOSITORIO] `preset-catalog.ts` |
| Backtesting | **B** | `simulate` (1 trade) + AutoQuant (investigación de factores/carteras) | [VERIFICADO EN REPOSITORIO] |
| Live trading | **A** (beta) / **C** | Brokers reales con claves; beta declarada | [DOCUMENTACIÓN] README |
| Scheduled analysis | **A** | Issues `at/every/cron` con zona horaria y catch-up | [VERIFICADO EN REPOSITORIO] |
| Scheduled trading | **B** | Issue programado + `allowAiTrading`; no determinístico, sin calendario de mercado | [VERIFICADO EN REPOSITORIO] |
| Monitoring 24/7 | **B** | Poller 10 s, salud de cuentas, snapshots; sin alertas de riesgo/PnL ni monitoreo externo | [VERIFICADO EN REPOSITORIO] |
| Recuperación después de errores | **B** | Recuperación de cuenta sí; UTA no se re-lanza en prod; pendiente en memoria; sin idempotencia | [VERIFICADO EN REPOSITORIO] `prod.mjs`, `TradingGit.ts` |
| Reconexión con broker | **A** | Loop de recuperación con backoff, `nudgeRecovery`, `POST /uta/:id/reconnect` | [VERIFICADO EN REPOSITORIO] |
| Registro de operaciones | **A** | `commit.json`, order/trade history, snapshots, event-log | [VERIFICADO EN REPOSITORIO] |
| Auditoría de decisiones de IA | **B** | Provenance commit↔Session (`src/server/trade-provenance.ts`), tool-call log, log de conversación; sin registro estructurado de features/confianza/stop/target | [VERIFICADO EN REPOSITORIO]; [DOCUMENTACIÓN] `docs/conversation-provenance.md` |

**Resumen honesto:** OpenAlice es hoy una buena **mesa de investigación asistida por LLM con un ledger de ejecución aprobable**. No es un sistema de trading autónomo, medible y seguro.

---

# 4. AUTONOMY GAP ANALYSIS

| ID | Brecha | Severidad | Clase | Dónde se resuelve |
|---|---|---|---|---|
| G1 | UTA sin autenticación; endpoints de push y one-shot accesibles desde cualquier proceso local; bypass de loopback en Alice | **Crítica** | D | UTA auth con scopes (§20) |
| G2 | La IA puede escribir la config de riesgo y el interruptor `allowAiTrading` | **Crítica** | D | Política de riesgo RO fuera del alcance del agente (§11, §21) |
| G3 | Guards fail-open, sin `modifyOrder`, cooldown en memoria | **Alta** | D | Risk Engine fail-closed (§11) |
| G4 | Sin pérdida diaria, drawdown, exposición, apalancamiento, horario, nº de trades, stop obligatorio | **Alta** | E | Risk Engine (§11) |
| G5 | Sin kill switch | **Alta** | E | §11.5 |
| G6 | Sin motor de estrategias ni señales determinísticas | **Alta** | E | Engine (§10) |
| G7 | Sin backtester de órdenes con comisiones y slippage | **Alta** | E | §14 |
| G8 | Sin position sizing | **Alta** | E | §10.6 |
| G9 | Sin monitor de posiciones (stops, trailing, time stops, reconciliación) | **Alta** | E | §13 |
| G10 | Sin idempotencia de órdenes; ledger escrito después de ejecutar; pendiente en memoria; escritura no atómica | **Alta** | D | WAL del Engine + cambios en UTA (§12) |
| G11 | UTA no se re-lanza en prod; Alice muerta = Guardian muerto | **Alta** | D | Guardian + restart policy (§21) |
| G12 | Sin despliegue de producción (Docker/compose) | **Media** | E | §21 |
| G13 | Sin métricas, alertas ni dead-man's switch | **Media** | E | §19 |
| G14 | Auditoría de decisiones no estructurada | **Media** | B | Decision record (§19) |
| G15 | Paper interno sin comisiones, slippage ni feed | **Media** | B | MockBroker + feeder o PaperBroker (§15) |
| G16 | Sin calendario de mercado | **Media** (acciones) / **Baja** (cripto) | E | `getMarketClock` + regla de horario (§11) |
| G17 | Sin linter | **Baja** | E | Opcional (ADR) |
| G18 | Staging compartido por cuenta (conflicto agente/Engine) | **Media** | B | Cuenta dedicada al Engine (§12) |


---

# 5. COMPONENTS TO REUSE

| Componente | Ruta | Uso en el sistema objetivo |
|---|---|---|
| Frontera Alice/UTA y `UTAClient` | `packages/uta-protocol/src/client/UTAClient.ts`, `src/services/uta-client/` | El Engine habla con UTA con el mismo cliente HTTP (más credencial de servicio) |
| Tipos de dominio | `@traderalice/uta-protocol` (`IBroker`, `Quote`, `Bar`, `BarParams`, `Position`, `AccountInfo`, `Operation`, `GitCommit`…), `@traderalice/ibkr` (`Contract`, `Order`) | Tipado del Engine; cero tipos duplicados |
| Trading as Git | `services/uta/src/domain/trading/git/TradingGit.ts` | Ledger de acciones sobre el broker; el hash del commit es la identidad de la decisión ejecutada |
| Pipeline de guards | `guards/guard-pipeline.ts`, `guards/types.ts` | Punto de inserción del Risk Engine (único cuello de botella de escrituras) |
| Brokers y presets | `brokers/*`, `packages/uta-protocol/src/brokers/preset-catalog.ts` | Ejecución paper/demo/testnet/live |
| MockBroker + rutas del simulador | `brokers/mock/MockBroker.ts`, `http/routes-simulator.ts` | Paper interno y tests de integración |
| Order-sync poller | `order-sync-poller.ts` | Detección de fills y cancelaciones (10 s) |
| Observación de órdenes externas | `UnifiedTradingAccount.observeExternalOrders()` | Detectar órdenes no colocadas por el sistema |
| Salud y reconexión de cuentas | `UnifiedTradingAccount` (health/recovery) | El Engine consulta la salud antes de operar |
| Snapshots de cuenta | `snapshot/*` | Curva de equity y base para pérdida diaria |
| Coste base / historial | `cost-basis.ts`, `order-history.ts` | PnL realizado y conciliación |
| Indicadores | `src/domain/analysis/indicator/functions/{technical,statistics}.ts` | Features de estrategias (importables vía `@/`) |
| Snapshot sin lookahead / frescura | `src/tool/snapshot.ts`, `src/domain/market-data/bars/{freshness,quality}.ts` | Ideas y código para controles de calidad de datos |
| Issues programados + Inbox | `src/workspaces/schedule/`, `src/workspaces/issues/`, `inbox_push` | Roles LLM asíncronos |
| Connector (Telegram) | `services/connector/`, `src/services/connector-client/uta-review.ts` | Aprobación móvil (modo 4) y alertas |
| Provenance | `src/server/trade-provenance.ts`, `docs/conversation-provenance.md` | Enlazar decisión LLM ↔ commit |
| `RestartBackoff` | `packages/guardian-runtime/src/restart-backoff.ts` | Reinicio del Engine y de UTA |
| Sellado de credenciales | `src/core/sealing.ts` | Se mantiene para las claves de broker |
| Carriles de test | `pnpm test:integration:uta`, `test:live:*-paper`, catálogo S1–S14 | Gates de aceptación |
| AutoQuant V2 | Plantilla `auto-quant-v2` | Investigación exploratoria (opcional); no reemplaza el backtester de órdenes |

---

# 6. COMPONENTS TO MODIFY

Cambios mínimos, justificados y sin romper APIs existentes. Todos son [PROPUESTA] sobre código [VERIFICADO EN REPOSITORIO].

| # | Archivo(s) | Cambio | Motivo | Compatibilidad |
|---|---|---|---|---|
| M1 | `services/uta/src/domain/trading/UnifiedTradingAccount.ts` (constructor, L180–205) | Insertar `RiskEngine` como **primer** paso del pipeline, antes de los guards existentes; también en `stage*` como pre-chequeo informativo | Aplicar el riesgo en el único cuello de botella | Los guards existentes siguen ejecutándose después |
| M2 | `guards/registry.ts` | Tipo desconocido → **error** (fail-closed) detrás del flag `OPENALICE_RISK_STRICT=1`; por defecto, warning como hoy | G3 | Sin flag, el comportamiento no cambia |
| M3 | `guards/cooldown.ts` | Registrar el timestamp solo tras un dispatch exitoso; persistirlo en el estado de riesgo | G3 | El test existente de cooldown debe seguir pasando o actualizarse con justificación |
| M4 | `git-persistence.ts` | Escritura atómica (tmp + `rename`, igual que `restart-trigger.ts`) | G10 | Mismo formato |
| M5 | `git/TradingGit.ts` | Persistir `stagingArea/pendingMessage/pendingHash` en un archivo `pending.json` y restaurarlo | G10 | Solo añade un archivo; sin migración si no existe |
| M6 | `StagePlaceOrderParams` (`uta-protocol`) + brokers | Campo opcional `clientOrderId` → `Order.orderRef` → mapeo por broker (CCXT `clientOrderId`, Alpaca `client_order_id`, IBKR `orderRef`) **tras verificar cada venue** | Idempotencia y reconciliación | Opcional; sin él, el comportamiento no cambia |
| M7 | `services/uta/src/main.ts` | Middleware de autenticación por token con scopes; `OPENALICE_UTA_BIND_HOST` (por defecto `127.0.0.1`); negarse a arrancar en bind no-loopback sin tokens (mismo patrón que Alice) | G1 | Sin tokens configurados y en loopback: modo compatibilidad con warning |
| M8 | `src/services/uta-client/*`, `src/webui/routes/trading-proxy.ts`, `packages/uta-protocol/src/client/UTAClient.ts` | Enviar `Authorization: Bearer <token>` si está configurado | G1 | Retrocompatible |
| M9 | `scripts/guardian/prod.mjs` | (a) Reiniciar UTA con `RestartBackoff` ante una salida inesperada; (b) modo "UTA externo" (`OPENALICE_UTA_EXTERNAL=1` + `OPENALICE_UTA_URL`): no lanza UTA, solo sondea su salud; (c) supervisar el Engine como servicio opcional igual que el Connector | G11 y topología dividida | Por defecto no cambia nada |
| M10 | `brokers/mock/MockBroker.ts` | Config opcional `feeBps`, `slippageBps` y soporte TRAIL (opcional) | G15 | Defaults = 0 → mismo comportamiento |
| M11 | `src/tool/trading.ts` | `tradingPush`: además del interruptor de Alice, respetar el modo de ejecución que devuelve UTA (§11.6) | Defensa en profundidad | Sin modo configurado, el comportamiento no cambia |
| M12 | Docs: `docs/project-structure.md`, `docs/uta-live-testing.md`, nuevo `docs/trading-engine.md`, `docs/risk-engine.md` | Documentar el nuevo proceso, el estado y las invariantes | Regla del repo: cambiar la guía en el mismo cambio | — |

**No modificar:** `src/ai-providers/`, adaptadores de agentes, la plantilla `chat`, la UI de Workspaces, migraciones existentes.

---

# 7. COMPONENTS TO BUILD

Todo lo de esta sección es [PROPUESTA].

| # | Componente | Ubicación propuesta | Responsabilidad |
|---|---|---|---|
| N1 | **Risk Engine** | `services/uta/src/domain/trading/risk/` | Reglas determinísticas fail-closed; política RO; estado persistente; log de decisiones |
| N2 | **Kill Switch** | `services/uta/src/domain/trading/risk/kill-switch.ts` + rutas `/api/trading/risk/*` | Estados NORMAL/HALT_NEW/FLATTEN; disparadores manuales y automáticos; persistente |
| N3 | **Engine Service** | `services/engine/` (paquete `@traderalice/engine-service`) | Scheduler, datos, features, régimen, estrategias, sizing, intenciones, ejecución, monitor, reconciliación |
| N4 | Market Data Store | `services/engine/src/data/` | Caché de barras con procedencia, calidad y frescura |
| N5 | Strategy SDK + estrategias A–E | `services/engine/src/strategies/` | Interfaz pura y módulos independientes |
| N6 | Regime Classifier | `services/engine/src/regime/` | Clasificación determinística (tendencia/rango/volatilidad) |
| N7 | Position Sizer | `services/engine/src/sizing/` | Riesgo fijo por trade, volatility targeting, topes |
| N8 | Execution Manager (WAL) | `services/engine/src/execution/` | Máquina de estados de `OrderIntent`, idempotencia, reconciliación |
| N9 | Position Monitor | `services/engine/src/monitor/` | Stops protectores, trailing, time stops, salidas por regla |
| N10 | Backtester | `services/engine/src/backtest/` | Event-driven, mismo código de estrategia, comisiones/slippage, walk-forward |
| N11 | Metrics & Promotion Gates | `services/engine/src/metrics/`, `src/gates/` | Métricas estándar e intervalos de confianza; evaluación de gates |
| N12 | Decision Journal | `services/engine/src/journal/` + SQLite | Registro completo por decisión |
| N13 | Alerting | `services/engine/src/alerts/` | Telegram directo + espejo opcional en el Inbox; dead-man's switch |
| N14 | Engine API | `services/engine/src/http/` | `/health`, `/status`, `/decisions/:id`, `/why?symbol&at`, `/advisory` (scope research), `/metrics` |
| N15 | Trading Desk Workspace | `default/skills/trading-desk-*` o plantilla nueva | Prompts de roles LLM y esquema JSON de advisory |
| N16 | Despliegue | `deploy/` (Dockerfiles, `compose.yaml`, `systemd/`, `backup/`) | Producción 24/7 |
| N17 | Tests | `services/engine/**/*.spec.ts`, `services/uta/src/domain/trading/risk/*.spec.ts`, e2e | Aceptación por fase |

---

# 8. PROPOSED ARCHITECTURE

## 8.1 Principios [PROPUESTA]

1. **Una sola autoridad de escritura:** toda orden pasa por UTA → Risk Engine → broker. Nadie más habla con el broker.
2. **Riesgo determinístico, fail-closed y fuera del alcance de la IA.**
3. **Mismo código en backtest, paper, testnet y live.** Solo cambia el adaptador de ejecución y el reloj.
4. **LLM asesor, nunca autoridad.** Un LLM puede *vetar o reducir*; nunca crear órdenes ni cambiar límites.
5. **Todo es un evento persistido antes de actuar** (write-ahead), y reconstruible.
6. **El broker es la fuente de verdad** de posiciones y órdenes; el sistema reconcilia.
7. **Fases con gates objetivos, fijados antes de ver los resultados.**

## 8.2 Diagrama

```text
                 Operador (Web UI · Telegram · SSH)
                   │ aprobaciones / kill switch / reset
┌──────────────── contenedor "alice" ─────────────────────────┐
│ Guardian(prod) ─ Alice :47331  ─ Connector :47334           │
│   Workspace "trading-desk" (Claude Code / Codex headless)   │
│   Issues programados: ContextAnalyst · Reviewer · PerfAnalyst│
└──────┬───────────────────────────────────────────┬──────────┘
       │ token UTA scope {read, stage, approve}     │ token Engine scope {advisory:write, read}
       ▼                                            ▼
┌──────── contenedor "uta" ───────────┐   ┌────────── contenedor "engine" ───────────────┐
│ UTA :47333 (red interna, auth)      │◄──│ Scheduler (reloj de barras cerradas)          │
│  ├ RiskEngine (fail-closed)         │tok│ MarketData ← UTA /historical, /quote          │
│  │   policy.json (bind RO del host) │eng│ Features → Regime → Strategies A–E            │
│  │   risk-state.json (volumen UTA)  │   │ Advisory filter (veto/reduce, TTL)            │
│  ├ KillSwitch (persistente)         │   │ Sizer → OrderIntent (WAL SQLite)              │
│  ├ Guards existentes                │   │ ExecutionManager → stage/commit/(push)        │
│  ├ TradingGit (ledger)              │   │ PositionMonitor · Reconciler · Metrics        │
│  └ Brokers: Mock/demo/testnet/live  │   │ Backtester (offline) · Alerts · API :47340    │
└─────────────────────────────────────┘   └───────────────────────────────────────────────┘
        volúmenes: uta-home (claves, ledger)          volúmenes: engine-data (SQLite, barras)
        host: /etc/openalice/risk-policy.json (RO)     host: /run/openalice-control/HALT (RO)
```

## 8.3 Ciclo de decisión (por barra cerrada)

```text
t = cierre de barra (intervalo configurado)
 1. Heartbeat + chequeos previos: kill switch, salud de cuenta (UTA), frescura de datos
 2. Actualizar barras (solo barras cerradas) y features
 3. Clasificar régimen
 4. Por cada estrategia habilitada × símbolo permitido: evaluate() → decisiones
 5. Agregar y resolver conflictos (una posición por símbolo; prioridad fija)
 6. Aplicar advisory LLM vigente (solo veto/reducción; se registra el contrafactual)
 7. Dimensionar (riesgo por trade, vol target, topes de política como espejo)
 8. Crear OrderIntent (WAL) → según el modo: registrar | paper | stage+commit | push
 9. UTA: RiskEngine autoritativo → broker
10. Monitor: stops protectores, trailing, time stops, salidas; reconciliación
11. Journal: DecisionRecord completo; métricas; alertas
```

## 8.4 Por qué un proceso aparte y no dentro de UTA ni de Alice

- **No en Alice:** `AGENTS.md` prohíbe "a parallel workflow engine in `src/`", y Alice debe funcionar sin trading. [DOCUMENTACIÓN]
- **No en UTA:** UTA es la autoridad de ejecución; mantenerla pequeña y determinística reduce la superficie de fallos. Si el Engine cae, UTA sigue protegiendo (stops en el broker, kill switch).
- **Alternativa considerada:** un Harness satélite (como AutoQuant o Auto Prediction) con "managed web surface". Encaja con la filosofía upstream, pero su ciclo de vida lo gobierna Alice y está pensado para Studio interactivo, no para un servicio 24/7 crítico. **Recomendación:** `services/engine` supervisado por Guardian (patrón Connector) en un fork, con un ADR documentado; si en el futuro se quiere contribuir upstream, reempaquetarlo como Harness. [INFERENCIA + PROPUESTA]

---

# 9. MULTI-AGENT DESIGN

## 9.1 Evaluación de la cadena propuesta (11 agentes)

| Agente propuesto | Veredicto | Motivo |
|---|---|---|
| Market Data Agent | **Módulo determinístico** | Obtener datos no requiere razonamiento; un LLM añade latencia, coste y errores |
| Market Regime Agent | **Módulo determinístico** + comentario LLM opcional | La clasificación debe ser backtesteable (ADX, pendiente de EMA, percentiles de volatilidad) |
| Technical Analysis Agent | **Módulo determinístico** | Los indicadores son funciones; ya existen en el repo |
| Fundamental/Macro Agent | **Rol LLM asíncrono** (ContextAnalyst) | Aporta contexto no estructurado; horizonte lento (diario/semanal) |
| News/Sentiment Agent | **Fusionado en ContextAnalyst** | Reutiliza el colector de noticias; salida = flags de riesgo con TTL |
| Strategy Agent | **Módulos determinísticos A–E** | Debe ser reproducible y backtesteable |
| Risk Agent | **Risk Engine determinístico en UTA** | El riesgo nunca debe depender de un LLM |
| Portfolio Agent | **Módulo determinístico** (Sizer + asignación) | Matemática, no juicio |
| Execution Agent | **Módulo determinístico** (ExecutionManager) | Máquina de estados, idempotencia |
| Position Monitor | **Módulo determinístico** | Bucle de control |
| Performance Analyst | **Rol LLM asíncrono** + métricas determinísticas | El LLM redacta e interpreta; las métricas se calculan en código |

**Conclusión:** la cadena secuencial de 11 LLM **no tiene sentido** para OpenAlice ni para trading medible [INFERENCIA]:
- **No backtesteable:** los LLM tienen fuga de información del periodo de test por su entrenamiento, no son determinísticos, y sus versiones cambian.
- **Frágil:** 11 llamadas en serie multiplican la probabilidad de error y la latencia (arranque de un CLI headless + tokens).
- **Caro:** tokens por símbolo, por barra y por agente.
- **Encaje con OpenAlice:** OpenAlice no tiene bucle de agente in-process; cada "agente" sería una ejecución headless de un CLI a través del scanner (~60 s). [VERIFICADO EN REPOSITORIO]

## 9.2 Diseño recomendado: "núcleo determinístico + supervisores asíncronos" [PROPUESTA]

```text
Camino crítico (determinístico, segundos):
  Data → Features → Regime → Strategies → Aggregator → AdvisoryFilter → Sizer → Execution → UTA/Risk
Fuera del camino crítico (LLM, minutos/horas, vía Issues de OpenAlice):
  ContextAnalyst (cada 4 h y pre-sesión) → advisory.json (veto/reduce, TTL)
  TradeReviewer (en modo 4, por commit pendiente) → resumen legible para aprobar en UI/Telegram
  PerformanceAnalyst (diario/semanal) → informe al Inbox + propuestas como Issues (nunca aplica cambios)
Supervisor (determinístico): watchdog del Engine (heartbeats, frescura, reconciliación, disparadores del kill switch)
```

**Por qué jerárquico-asíncrono y no paralelo sincrónico:** los roles LLM producen *contexto*, no órdenes. Se ejecutan en paralelo entre sí (Issues independientes), pero nunca bloquean el ciclo de trading. Si un rol falla o su advisory caduca, el Engine sigue con el comportamiento por defecto configurado (`advisory_missing_policy: ignore | halt_new`).

## 9.3 Contrato del Advisory (salida del ContextAnalyst) [PROPUESTA]

```json
{
  "schemaVersion": 1,
  "advisoryId": "adv_2026-09-24T12:00Z_ctx",
  "producedBy": { "workspaceId": "trading-desk", "resumeId": "…", "issueId": "context-4h", "model": "…" },
  "createdAt": "2026-09-24T12:00:00Z",
  "expiresAt": "2026-09-24T16:00:00Z",
  "scope": [{ "symbol": "BTC/USDT:USDT", "account": "bybit-demo-engine" }],
  "action": "VETO_NEW_LONGS | VETO_NEW_SHORTS | VETO_ALL_NEW | REDUCE_SIZE | NONE",
  "sizeMultiplier": 0.5,
  "reasonCodes": ["MACRO_EVENT_FOMC", "EXCHANGE_INCIDENT"],
  "evidence": [{ "type": "news", "ref": "…", "summary": "…" }],
  "confidence": "low | medium | high"
}
```
Reglas: validación Zod estricta; `sizeMultiplier ∈ [0, 1]` (solo reduce); TTL máximo 24 h; sin campo que pueda crear o agrandar una orden. Cada decisión registra `advisory_applied` y el **contrafactual** (qué habría hecho sin advisory) para medir si el LLM aporta valor. **El advisory arranca en modo sombra** (se registra pero no se aplica) hasta que las métricas en paper demuestren beneficio (§14.6).

---

# 10. STRATEGY ENGINE

Todo [PROPUESTA].

## 10.1 Interfaz

```ts
// services/engine/src/strategies/types.ts
export interface StrategyContext {
  asOf: Date                        // cierre de la última barra CERRADA
  symbol: string                    // aliceId del contrato
  bars: Record<BarInterval, ClosedBar[]>  // solo barras cerradas, orden ascendente
  features: FeatureSet              // precomputadas y cacheadas por (symbol, interval, asOf)
  regime: RegimeLabel               // 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'HIGH_VOL' | 'UNKNOWN'
  position: PositionView | null     // posición gestionada por esta estrategia (si existe)
  params: unknown                   // validado por paramsSchema
}
export type StrategyDecision =
  | { kind: 'NONE'; reasonCodes: string[] }
  | { kind: 'ENTER'; side: 'LONG' | 'SHORT'; entry: EntrySpec; stop: string; target?: string;
      score: number /* 0..1 determinístico */; reasonCodes: string[]; timeStopBars?: number }
  | { kind: 'EXIT'; reasonCodes: string[] }
  | { kind: 'ADJUST_STOP'; newStop: string; reasonCodes: string[] }   // solo puede ajustar
export interface Strategy {
  id: string; version: string          // semver; cambia si cambia la lógica
  paramsSchema: z.ZodType
  warmup(params): Array<{ interval: BarInterval; bars: number }>
  evaluate(ctx: StrategyContext): StrategyDecision
}
```

**Invariantes obligatorias** (tests de propiedad):
- Función pura: sin I/O, sin `Date.now()`, sin azar (o con semilla explícita).
- Solo barras cerradas: `bars[i].closeTime <= asOf`; test de **no-lookahead**: evaluar con datos truncados en `asOf` debe dar el mismo resultado que con datos completos.
- `ENTER` exige `stop`. Sin stop no hay entrada.
- Precios como `string` decimal; aritmética de dinero con `decimal.js`; los indicadores pueden usar `number`.

## 10.2 Registro y configuración

```yaml
# engine/config/strategies.yaml  (versionado en git; hash en cada DecisionRecord)
strategies:
  - id: trend_following
    version: 1.0.0
    enabled: true
    mode_cap: PAPER            # tope de modo para ESTA estrategia (no puede superar el global)
    universe: ["bybit-demo-engine|BTCUSDT", "bybit-demo-engine|ETHUSDT"]   # aliceIds reales tras contract search
    interval: 1h
    params: { fast: 20, slow: 50, atrPeriod: 14, atrStopMult: 2.5 }
    allocation: { riskPerTradePct: 0.5, maxConcurrent: 2 }
    regimes_allowed: [TREND_UP, TREND_DOWN]
```
Cada estrategia es un módulo independiente que se puede activar, configurar, backtestear, paper-tradear y comparar; cada una tiene sus propias métricas (tag `strategy_id` + `strategy_version` + `params_hash` en todas las tablas).

## 10.3 Estrategias de referencia (plantillas; **no se afirma rentabilidad**)

| ID | Lógica determinística (parametrizable) | Salidas | Régimen |
|---|---|---|---|
| A `trend_following` | EMA(fast) cruza EMA(slow); filtro de pendiente de EMA(slow) | Stop = entrada ∓ k·ATR; trailing ATR; salida por cruce inverso | TREND_* |
| B `mean_reversion` | z-score del cierre vs SMA(n) ≤ −z (largo) / ≥ +z (corto), con RSI extremo | Target = SMA(n); stop k·ATR; time stop N barras | RANGE |
| C `breakout` | Cierre > HIGHEST(high, n) (o < LOWEST) con RVOL ≥ r | Stop = LOWEST(low, m) o k·ATR; trailing | TREND_* / transición |
| D `momentum` | Ranking por ROC(n) del universo; long top-k (y short bottom-k si se permite); rebalanceo periódico | Salida al salir del top-k o por stop | TREND_UP (long) |
| E `regime_switch` | Meta-estrategia: activa o pondera A–D según el régimen | Hereda las de la sub-estrategia | todos |

Indicadores disponibles en el repo: SMA, EMA, RSI, BBANDS, MACD, ATR, RVOL, OBV, MFI, VWAP, STDEV, ROC, ZSCORE, SLOPE, HIGHEST, LOWEST, CORRELATION. [VERIFICADO EN REPOSITORIO] **ADX no existe** → implementarlo en el Engine con tests contra valores de referencia calculados a mano.

## 10.4 Clasificador de régimen

Determinístico y configurable: tendencia por pendiente de EMA(100) normalizada por ATR y/o ADX(14) ≥ umbral; volatilidad por percentil de la volatilidad realizada (20 barras) sobre una ventana de 1 año; `HIGH_VOL` tiene prioridad. Salida: etiqueta + features usadas (se registran).

## 10.5 Agregación y conflictos
- Una posición neta por (cuenta, símbolo). Si dos estrategias piden direcciones opuestas → `NONE` y se registra el conflicto.
- Prioridad fija configurable; nada de "votar por score" sin backtest que lo justifique.

## 10.6 Position sizing
- **Riesgo fijo por trade:** `qty = (equity × riskPct) / |entry − stop| / multiplier`, redondeado hacia abajo al `lotSize/minQty` del contrato (de `getContractDetails`).
- **Volatility targeting** (opcional): escalar para que la volatilidad de la posición ≈ objetivo.
- **Topes:** por símbolo, cartera, apalancamiento y valor máximo de orden, aplicados como *espejo* en el Engine (para no generar intents inválidos); la autoridad es el Risk Engine de UTA.
- Resultado < `minQty` → `NONE` con reason `SIZE_BELOW_MIN`.

---

# 11. RISK ENGINE

Todo [PROPUESTA], anclado en código [VERIFICADO EN REPOSITORIO] (`UnifiedTradingAccount` L180–205, `guards/guard-pipeline.ts`).

## 11.1 Ubicación y flujo

```text
TradingGit.push → executeOperation(op)
   └→ RiskEngine.check(op, ctx)      ← NUEVO, primero, fail-closed
        └→ guards existentes (compat)
             └→ dispatcher → broker
```
Además, `stagePlaceOrder/stageModifyOrder` llaman a `RiskEngine.precheck()` para dar feedback temprano (no autoritativo). La comprobación **autoritativa** es la del dispatcher, con datos frescos en el momento del push.

## 11.2 Política (solo lectura, fuera del alcance de la IA)

```jsonc
// /etc/openalice/risk-policy.json (host) → montado RO en el contenedor UTA
{
  "version": 3,
  "effectiveFrom": "2026-10-01T00:00:00Z",
  "timezone": "UTC",                       // día de trading para la pérdida diaria
  "executionModeMax": "PAPER",             // techo de modo global (§11.6)
  "accounts": {
    "bybit-demo-engine": {
      "allowedSymbols": ["BTCUSDT", "ETHUSDT"],     // por nativeKey/aliceId verificado
      "allowedSecTypes": ["CRYPTO"],
      "allowedActions": ["placeOrder", "modifyOrder", "closePosition", "cancelOrder"],
      "tradingHours": { "type": "always" },         // o { "type": "brokerClock" } o ventanas
      "maxOrderNotional": "500",
      "maxPositionNotional": "1000",
      "maxPositionPctEquity": 10,
      "maxGrossExposurePctEquity": 30,
      "maxNetExposurePctEquity": 30,
      "maxLeverage": 1,
      "maxOpenPositions": 2,
      "maxTradesPerDay": 6,
      "maxTradesPerSymbolPerDay": 3,
      "cooldownSecondsPerSymbol": 900,
      "maxRiskPerTradePctEquity": 0.5,
      "requireStopLoss": true,
      "maxDailyLossPctEquity": 2,
      "maxDrawdownPctFromHWM": 8,
      "priceBandPct": 1.5,
      "maxQuoteAgeSeconds": 30,
      "maxConsecutiveRejects": 5,
      "capitalCap": "2000"                          // equity máxima considerada operable
    }
  }
}
```
- Se carga desde `OPENALICE_RISK_POLICY_PATH`, se valida con Zod y se registra su `sha256` al arrancar y en cada decisión.
- **Ausente, inválida o ilegible → estado `HALT_NEW`** (fail-closed) y alerta.
- **No hay ningún endpoint HTTP que escriba la política.** Se cambia editando el archivo en el host (SSH) y recargando con `SIGHUP` o reiniciando.
- Los `guards[]` de `accounts.json` (editables en la UI) siguen activos y **solo pueden añadir restricciones**: el efecto es la intersección.

## 11.3 Reglas (orden de evaluación, todas determinísticas)

| # | Regla | Aplica a | Datos | Si faltan datos |
|---|---|---|---|---|
| R0 | Kill switch (`HALT_NEW` bloquea todo lo que aumente el riesgo) | place, modify que aumente | estado | rechazar |
| R1 | Acción permitida | todas | op | rechazar |
| R2 | Cuenta/exchange permitido | todas | account id | rechazar |
| R3 | Símbolo y secType permitidos | place, modify, close | contrato | rechazar (salvo close/cancel: siempre permitidos para reducir riesgo) |
| R4 | Horario de trading | place | `getMarketClock` o ventana | rechazar |
| R5 | Frescura de quote ≤ `maxQuoteAgeSeconds` | place, modify | `getQuote` | rechazar |
| R6 | Banda de precio (LMT/STP dentro de ±x % del last) | place, modify | quote | rechazar |
| R7 | Notional de la orden ≤ `maxOrderNotional` (qty × precio × multiplier, o `cashQty`) | place, modify | quote, contrato | rechazar |
| R8 | Notional de la posición resultante y % equity | place, modify | posiciones, cuenta | rechazar |
| R9 | Exposición bruta/neta de la cartera | place, modify | posiciones | rechazar |
| R10 | Apalancamiento resultante | place | cuenta | rechazar |
| R11 | Nº de posiciones abiertas | place (nueva) | posiciones | rechazar |
| R12 | Trades por día (cuenta, símbolo) | place | estado persistente | rechazar |
| R13 | Cooldown por símbolo | place | estado persistente | rechazar |
| R14 | Stop obligatorio (`tpsl.stopLoss`, o una orden STP reduce-only viva para esa posición) | place (entrada) | op, órdenes abiertas | rechazar |
| R15 | Riesgo por trade = \|entry − stop\| × qty × mult ≤ x % equity | place | op | rechazar |
| R16 | Pérdida diaria (equity actual vs equity al inicio del día) | place; **dispara el kill switch** | snapshot + cuenta | rechazar |
| R17 | Drawdown desde el máximo histórico (HWM) persistido | place; **dispara el kill switch** | estado | rechazar |
| R18 | `modifyOrder`: no aumentar qty por encima de los límites; un stop solo puede moverse a favor (tighten-only) | modify | orden original | rechazar |
| R19 | Rechazos consecutivos ≥ N → kill switch | — | contador | — |
| R20 | `capitalCap`: usar min(equity, cap) como base de todos los % | todas | cuenta | — |

`closePosition` y `cancelOrder` **siempre** se permiten salvo la validación de cantidad que ya existe (reducen riesgo). [VERIFICADO EN REPOSITORIO: la validación de cantidad existe]

## 11.4 Estado persistente y log

- `data/trading/_risk/risk-state.json` (escritura atómica): `dayKey`, `startOfDayEquity`, `hwmEquity`, `tradesToday{account,symbol}`, `lastTradeAt{symbol}`, `consecutiveRejects`, `killSwitch{state, reason, since, by}`.
- `data/trading/_risk/risk-decisions.jsonl` (append-only): `{ts, account, op(compact), policyHash, inputs{quote, equity, positionsDigest}, results[{rule, pass, detail}], verdict}`.
- Estado ilegible o corrupto → `HALT_NEW` + alerta; nunca se "resetea en silencio".

## 11.5 Kill switch

| Estado | Efecto |
|---|---|
| `NORMAL` | Operación normal |
| `HALT_NEW` | Rechaza cualquier op que aumente el riesgo; permite cancel y close |
| `FLATTEN` | `HALT_NEW` + cancela órdenes de entrada abiertas + cierra posiciones (reduce-only) — requiere confirmación del operador |

- **Activación manual:** `POST /api/trading/risk/kill-switch` (scope `operator`), botón en la UI (vía el proxy de Alice), comando de Telegram `/halt` (extensión del Connector) y un **archivo en el host** `/run/openalice-control/HALT` montado RO (su presencia fuerza `HALT_NEW`; imposible de borrar desde dentro del contenedor).
- **Activación automática:** R16, R17, R19, cuenta `offline` más de X min con posiciones abiertas, datos obsoletos más de X min (reportado por el Engine), discrepancia de reconciliación, desfase de reloj > 2 s.
- **Reset:** solo con scope `operator` y un `reason` obligatorio; un halt por pérdida diaria no se puede resetear antes del siguiente `dayKey` salvo con `force` explícito (queda auditado).
- **Persistente:** sobrevive reinicios; al arrancar, el estado es el anterior.
- El Engine tiene además un kill local (deja de producir intents), pero la autoridad es UTA.

## 11.6 Modos de ejecución (Human Oversight)

| Modo | Nombre | Engine | UTA acepta |
|---|---|---|---|
| 1 | `RESEARCH_ONLY` | Solo calcula y registra features/régimen | Ninguna escritura del Engine |
| 2 | `SIGNAL_ONLY` | Registra decisiones y alerta; sin intents | Ninguna escritura |
| 3 | `PAPER` | Ejecuta contra una cuenta paper (MockBroker alimentado o demo) | Solo cuentas marcadas `paper` |
| 4 | `HUMAN_APPROVAL` | stage + commit; espera aprobación (UI/Telegram); caduca a los N min → `reject` | `push` solo con scope `approve` (humano) |
| 5 | `SEMI_AUTONOMOUS` | Push automático si el intent está dentro de un **sobre automático** más estrecho (p. ej. ≤ 50 % de los límites); si no, modo 4 | `push` con scope `engine` solo si pasa el sobre |
| 6 | `FULLY_AUTOMATED` | Push automático dentro de la política | `push` con scope `engine` |

- **Modo efectivo = min(modo global en la config del Engine, `executionModeMax` de la política RO, `mode_cap` de la estrategia, modo por cuenta).** El techo lo fija la política del host, que la IA no puede tocar.
- `agent.allowAiTrading` debe quedarse en `false` en todas las fases: los agentes LLM no hacen push.

---

# 12. EXECUTION ENGINE

Todo [PROPUESTA].

## 12.1 Máquina de estados de `OrderIntent`

```text
CREATED → (mode≤2: RECORDED ■)
        → RISK_MIRROR_OK | RISK_MIRROR_REJECTED ■
        → STAGED → COMMITTED ─(mode 4)→ AWAITING_APPROVAL ─approve→ PUSHING
                              └(mode 5/6)────────────────────────→ PUSHING
        AWAITING_APPROVAL ─timeout/reject→ EXPIRED/REJECTED ■
        PUSHING → SUBMITTED | REJECTED ■ | UNKNOWN (timeout/crash)
        SUBMITTED → PARTIALLY_FILLED → FILLED ■ | CANCELLED ■
        UNKNOWN → RECONCILED(SUBMITTED|FILLED|NOT_FOUND) | NEEDS_HUMAN (HALT_NEW del símbolo)
```
- **Write-ahead:** cada transición se persiste en SQLite (`order_intents` + `order_events`) **antes** de la llamada externa.
- **Idempotencia:** `clientOrderId = "oa-" + base32(intentId)[0:20]` (verificar el formato y la longitud máxima por venue). Tras M6, UTA lo propaga. Hasta entonces, la reconciliación usa (símbolo, lado, qty, ventana temporal) y cualquier ambigüedad → `NEEDS_HUMAN`.
- **Nunca reintentar `push` a ciegas.** Tras un timeout, el estado pasa a `UNKNOWN` y se reconcilia con `getOrders`/`sync`/`orderHistory` antes de hacer cualquier otra cosa.
- **Un commit pendiente por cuenta** (restricción de TradingGit [VERIFICADO EN REPOSITORIO]) → cola serializada por cuenta en el Engine.
- **Cuenta dedicada:** el Engine opera solo en cuentas marcadas `engineOwned` en su config; si detecta staging ajeno en esa cuenta → alerta y no toca nada.

## 12.2 Tipos de orden y protección
- Entrada: `LMT` con timeout (cancelar si no se llena en N segundos), o `MKT` con verificación posterior de slippage; parámetros por estrategia.
- Protección: `tpsl.stopLoss` adjunto si `getCapabilities()` y el preset lo soportan; si no, orden `STP` reduce-only inmediatamente tras el fill (el monitor verifica que existe).
- Derivados: cierres con `reduceOnly` (ya lo hace `CcxtBroker.closePosition`). [VERIFICADO EN REPOSITORIO]

## 12.3 Reintentos y rate limits
- **Lecturas:** backoff exponencial con jitter (reutilizar `RestartBackoff` o un helper equivalente), máximo N intentos, con presupuesto de tiempo.
- **Escrituras:** 0 reintentos automáticos; reconciliación.
- **Limitador del Engine:** token bucket por cuenta (p. ej. ≤ 5 escrituras/min y ≤ 60 lecturas/min, configurable), además del limitador interno de CCXT.

---

# 13. POSITION MANAGEMENT

[PROPUESTA]

- **Bucle del monitor** (cada 10–15 s, alineado con el poller de UTA): leer posiciones, órdenes abiertas y quotes vía UTA.
- **Invariante P1:** toda posición gestionada tiene un stop protector vivo en el broker. Si falta → recrearlo; si no se puede → alerta crítica + `FLATTEN` de esa posición (configurable).
- **Invariante P2:** el stop solo se mueve a favor (espejo de R18).
- **Trailing:** recalcular por barra cerrada (no por tick) → `stageModifyOrder` del STP → commit/push según el modo.
- **Time stop:** cerrar tras N barras sin alcanzar el target.
- **Salidas por estrategia:** una decisión `EXIT` → `stageClosePosition`.
- **Reconciliación** (cada ciclo + al arrancar): posiciones del broker vs posiciones del Engine; diferencia → `HALT_NEW` del símbolo + alerta; las órdenes externas las registra UTA (`observeExternalOrders`) y el Engine las marca como no gestionadas.
- **Fills parciales:** el tamaño de protección sigue la cantidad llenada; el remanente se cancela tras el timeout de entrada.
- **Arranque tras un reinicio:** reconstruir el estado desde SQLite + broker; nada se decide hasta terminar la reconciliación.

---

# 14. BACKTESTING

Todo [PROPUESTA].

## 14.1 Diseño
- **Event-driven, barra a barra**, con el **mismo** `Strategy.evaluate`, `Regime`, `Sizer` y un `RiskMirror` que replica las reglas de la política (para que el backtest no genere trades que live rechazaría).
- **Reloj simulado** inyectado; prohibido `Date.now()` en el código compartido (se aplica con una regla de test).
- **Modelo de fills (conservador):** entrada al *open* de la barra siguiente ± slippage (bps configurables por símbolo, calibrables con los datos de paper); LMT se llena solo si el precio cruza el límite (no basta con tocarlo); STP se dispara si `low ≤ stop` (long). **Si en la misma barra se tocan el stop y el target, se asume el stop.**
- **Comisiones** por venue (maker/taker) desde la config; **funding** de perpetuos: no modelado en v1 → se marca `funding_modeled=false` en el run (limitación explícita).
- **Datos:** barras del venue obtenidas por UTA (`POST /uta/:id/historical`, intervalos `1m…1w`) [VERIFICADO EN REPOSITORIO] y cacheadas en SQLite con `source`, `fetchedAt`, `sha256` del dataset; chequeos de calidad (huecos, duplicados, OHLC inconsistente, volumen 0).
- **Reproducibilidad:** `run_id = hash(dataset_hash, strategy_id@version, params_hash, engine_git_sha, fill_model_hash, seed)`.

## 14.2 Validación anti-sobreajuste
- **Walk-forward:** ventanas in-sample/out-of-sample rodantes (p. ej. 12 m IS / 3 m OOS); solo se reportan métricas OOS agregadas para los gates.
- **Registro de pruebas múltiples:** cada combinación de parámetros probada se guarda (`backtest_runs`); el gate usa el número total de variantes probadas para ajustar el umbral (p. ej. Sharpe deflactado o una corrección de Bonferroni sobre el p-valor del bootstrap).
- **Estabilidad de parámetros:** ±20 % en cada parámetro no debe volver negativa la expectativa OOS.
- **Holdout final** de un periodo que nunca se usó para seleccionar (se consume una sola vez).

## 14.3 Métricas (definiciones)

| Métrica | Definición |
|---|---|
| Total return | `E_final / E_inicial − 1` |
| CAGR | `(E_final/E_inicial)^(365/días) − 1` (solo si el periodo ≥ 1 año) |
| Win rate / Loss rate | trades con PnL neto > 0 / < 0 sobre el total cerrado |
| Average win / loss | media del PnL neto de ganadores / perdedores |
| Average trade | PnL neto total / nº de trades |
| Profit factor | Σ ganancias netas / \|Σ pérdidas netas\| |
| Expectancy | `win_rate·avg_win − loss_rate·|avg_loss|` (también en múltiplos de R) |
| Max drawdown | máx. caída pico-valle de la curva de equity (mark-to-market por barra) |
| Volatility | desviación estándar de los retornos diarios × √365 (cripto) o × √252 (acciones) |
| Sharpe | media(r_d − rf) / sd(r_d) × √N (rf configurable, por defecto 0) |
| Sortino | media(r_d − rf) / sd_downside × √N |
| Exposure | % del tiempo con posición abierta y exposición media / equity |
| Number of trades | trades cerrados (y abiertos al final, por separado) |
| Fees | Σ comisiones; también como % del PnL bruto |
| Slippage | Σ (precio de fill − precio de referencia) × qty; en bps |
| IC de la expectativa | bootstrap (10.000 remuestreos) → IC 95 % |

## 14.4 Gate: BACKTEST → PAPER (todos obligatorios, fijados antes de ver resultados)
1. ≥ **200 trades OOS** (≥ 100 si la estrategia es de baja frecuencia y abarca ≥ 3 regímenes etiquetados).
2. Expectativa OOS neta de comisiones y slippage > 0, con **límite inferior del IC 95 % > 0**.
3. Profit factor OOS ≥ **1,2**.
4. Max drawdown OOS ≤ **1,5 × `maxDrawdownPctFromHWM`** de la política objetivo.
5. Sharpe OOS ≥ **0,8** tras el ajuste por pruebas múltiples.
6. Estabilidad de parámetros aprobada (§14.2).
7. Ningún mes OOS aporta más del 30 % del PnL total (evita resultados que dependen de un solo evento).
8. Test de no-lookahead y de determinismo en verde.

Los umbrales son **iniciales y conservadores** [PROPUESTA]; se cambian solo por ADR y antes de ejecutar los tests, nunca después.

## 14.5 Relación con AutoQuant
AutoQuant sirve para investigación exploratoria (factores, carteras, eventos). Si una idea sale de ahí, se reimplementa como `Strategy` del Engine y pasa por este backtester y sus gates. No se importan resultados de AutoQuant como evidencia de gate. [PROPUESTA]

## 14.6 Evaluación del advisory LLM
El advisory no se puede backtestear de forma honesta (fuga temporal). Se evalúa **solo hacia adelante**, en paper y en modo sombra: comparar el PnL y el drawdown de "con advisory" vs el contrafactual "sin advisory" con ≥ 60 días y ≥ 50 decisiones afectadas. Solo se activa si reduce el drawdown o mejora la expectativa con IC que no cruce 0. [PROPUESTA]

---

# 15. PAPER TRADING

[PROPUESTA sobre componentes VERIFICADOS]

**Definición:** ejecución simulada con **datos de mercado en vivo** y el **camino completo** (Engine → UTA → Risk Engine → TradingGit → broker simulado).

- **Opción recomendada:** una cuenta `mock-simulator` **no efímera** (`ephemeral` purga el historial al arrancar [VERIFICADO EN REPOSITORIO: `config.ts` L458–482]) alimentada por un **PriceFeeder** del Engine que, cada N segundos, toma quotes de una fuente real (UTA keyless o cuenta demo del mismo venue) y llama a `POST /api/simulator/uta/:id/mark-price` [VERIFICADO EN REPOSITORIO: la ruta existe]. Requiere M10 (comisiones y slippage en MockBroker).
- **Ventaja:** ejercita el Risk Engine, TradingGit, el poller y la reconciliación reales; la única diferencia con live es el broker.
- **Limitación honesta:** el matching simulado no reproduce la liquidez ni la cola del libro; por eso existe la etapa de testnet/demo.

**Gate PAPER → TESTNET:**
1. ≥ **30 días naturales** continuos y ≥ **50 trades** cerrados.
2. Expectativa por trade dentro del IC 95 % del backtest OOS (si cae por debajo → volver a backtest).
3. Slippage medio real del modelo de paper ≤ el asumido en el backtest + 25 %.
4. **0** violaciones de invariantes (P1, P2, R*), **0** órdenes duplicadas y **0** intents en `NEEDS_HUMAN` sin resolver.
5. Uptime del Engine ≥ 99 % (heartbeats) y ≥ 2 reinicios forzados superados sin pérdida de estado.
6. Simulacro de kill switch (manual y automático) superado.

---

# 16. TESTNET

[VERIFICADO EN REPOSITORIO: presets; PROPUESTA: uso]

- **Cripto:** Bybit **Demo** (datos reales, matching simulado) es preferible a Bybit Testnet (datos falsos) para validar el comportamiento de ejecución; OKX Demo y Binance Demo también. Hyperliquid Testnet si se opera allí. [DOCUMENTACIÓN: hints de `preset-catalog.ts`]
- **Acciones EE. UU.:** Alpaca paper; IBKR paper vía TWS/Gateway.
- **Aceptación del conector:** antes de la etapa, ejecutar el catálogo S1–S14 aplicable (`docs/uta-live-testing.md`) con `OPENALICE_UTA_LIVE_PAPER=1 pnpm test:live:<broker>-paper` y verificar que la cuenta queda plana.
- **Validar además:** que los TP/SL adjuntos llegan al venue (el dogfooding del repo encontró "an attached TP/SL that the ledger showed but the exchange never received" [DOCUMENTACIÓN]), que los ids de orden no se truncan, cancelación por id, fills parciales y cierres con reduce-only.

**Gate TESTNET → SMALL LIVE:**
1. ≥ **14 días** y ≥ **30 órdenes** reales en el venue demo.
2. **100 %** de reconciliación del ciclo de vida de órdenes (intent ↔ commit ↔ orden del broker ↔ fills).
3. Todos los stops y targets se ejecutaron en el venue (verificado en el historial del broker).
4. Pruebas de caos superadas: matar el Engine con posición abierta; matar UTA durante un push; cortar la red 5 min; reiniciar el host.
5. Rendimiento no inferior al paper más allá de lo que explique el slippage medido.
6. Revisión humana firmada (ADR de promoción) con el informe del PerformanceAnalyst adjunto.

---

# 17. LIVE TRADING

[PROPUESTA]

- **Preparación de la cuenta:** sub-cuenta dedicada al Engine; API key **solo trading, sin retiros**, con IP allowlist del VPS; claves distintas por etapa; nunca reutilizar las claves de demo.
- **Small live:** `capitalCap` en la política (p. ej. el 1–5 % del capital previsto, o un monto fijo que se pueda perder por completo sin consecuencias), `executionModeMax` empezando en `HUMAN_APPROVAL` durante ≥ 2 semanas y luego `SEMI_AUTONOMOUS`.
- **Gate SMALL LIVE → SCALE:** ≥ **60–90 días** y ≥ **50 trades**; slippage live vs paper dentro de lo esperado; drawdown ≤ el límite; 0 incidentes críticos; expectativa en el IC del backtest.
- **Escalado:** multiplicar `capitalCap` como máximo × 2 por periodo de 30 días sin incidentes; cualquier breach de R16/R17 → volver al nivel anterior automáticamente (bajar el cap requiere editar la política: acción humana registrada).
- **Regulación e impuestos:** fuera del alcance técnico; consultar con un profesional local antes de operar con dinero real. Esto no es asesoría legal ni financiera.

---

# 18. DATABASE

[PROPUESTA] SQLite en el Engine (un archivo, modo WAL, `busy_timeout`), coherente con que OpenAlice no use una BD de servidor. **Decisión técnica pendiente en la Fase 1 (ADR):** `node:sqlite` (integrado en Node; verificar estabilidad en la versión fijada ≥ 22.19) vs `better-sqlite3` (módulo nativo: requiere añadirlo a `allowBuilds` en `pnpm-workspace.yaml` [VERIFICADO EN REPOSITORIO: existe esa lista]). Migraciones SQL versionadas en `services/engine/migrations/NNNN_*.sql` con tabla `schema_migrations`.

```sql
-- 0001_init.sql
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE config_versions (          -- snapshot de cada config usada
  config_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('engine','strategies','risk_policy_mirror')),
  content_json TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE strategies (
  strategy_id TEXT NOT NULL, version TEXT NOT NULL, code_git_sha TEXT NOT NULL,
  params_schema_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (strategy_id, version));

CREATE TABLE market_bars (
  source TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL, open_time TEXT NOT NULL,
  open TEXT NOT NULL, high TEXT NOT NULL, low TEXT NOT NULL, close TEXT NOT NULL, volume TEXT NOT NULL,
  close_time TEXT NOT NULL, fetched_at TEXT NOT NULL,
  PRIMARY KEY (source, symbol, interval, open_time));

CREATE TABLE datasets (dataset_hash TEXT PRIMARY KEY, source TEXT, symbol TEXT, interval TEXT,
  start_time TEXT, end_time TEXT, bar_count INTEGER, quality_json TEXT, created_at TEXT);

CREATE TABLE cycles (                    -- un ciclo de decisión (barra cerrada)
  cycle_id TEXT PRIMARY KEY, as_of TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  mode TEXT NOT NULL, engine_git_sha TEXT NOT NULL, config_hash TEXT NOT NULL,
  risk_policy_hash TEXT, kill_switch_state TEXT, status TEXT NOT NULL, error TEXT);

CREATE TABLE feature_snapshots (
  snapshot_id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES cycles, symbol TEXT NOT NULL,
  interval TEXT NOT NULL, as_of TEXT NOT NULL, features_json TEXT NOT NULL, features_hash TEXT NOT NULL,
  last_bar_close_time TEXT NOT NULL, data_age_seconds INTEGER NOT NULL);

CREATE TABLE regimes (cycle_id TEXT NOT NULL REFERENCES cycles, symbol TEXT NOT NULL, label TEXT NOT NULL,
  inputs_json TEXT NOT NULL, PRIMARY KEY (cycle_id, symbol));

CREATE TABLE decisions (                 -- DecisionRecord: una por estrategia×símbolo×ciclo (incluye NONE)
  decision_id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES cycles,
  strategy_id TEXT NOT NULL, strategy_version TEXT NOT NULL, params_hash TEXT NOT NULL,
  symbol TEXT NOT NULL, account_id TEXT, as_of TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('NONE','ENTER','EXIT','ADJUST_STOP')),
  side TEXT, score REAL, entry_price TEXT, stop_price TEXT, target_price TEXT,
  reason_codes_json TEXT NOT NULL, feature_snapshot_id TEXT REFERENCES feature_snapshots,
  regime_label TEXT, advisory_id TEXT, advisory_action TEXT, counterfactual_json TEXT,
  sizing_json TEXT, planned_qty TEXT, planned_risk TEXT, final_outcome TEXT,
  created_at TEXT NOT NULL);
CREATE INDEX idx_decisions_symbol_time ON decisions(symbol, as_of);

CREATE TABLE llm_advisories (
  advisory_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, producer_json TEXT NOT NULL,
  received_at TEXT NOT NULL, expires_at TEXT NOT NULL, valid INTEGER NOT NULL, validation_error TEXT,
  applied_mode TEXT NOT NULL CHECK (applied_mode IN ('SHADOW','ACTIVE')));

CREATE TABLE risk_mirror_checks (         -- espejo del Engine; la autoridad está en UTA risk-decisions.jsonl
  check_id TEXT PRIMARY KEY, decision_id TEXT REFERENCES decisions, results_json TEXT NOT NULL,
  verdict TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE order_intents (
  intent_id TEXT PRIMARY KEY, decision_id TEXT REFERENCES decisions, account_id TEXT NOT NULL,
  symbol TEXT NOT NULL, action TEXT NOT NULL, side TEXT, order_type TEXT NOT NULL,
  qty TEXT, cash_qty TEXT, limit_price TEXT, stop_price TEXT, tp_price TEXT, sl_price TEXT,
  client_order_id TEXT UNIQUE, state TEXT NOT NULL, mode TEXT NOT NULL,
  uta_commit_hash TEXT, broker_order_id TEXT, expires_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_intents_state ON order_intents(state);

CREATE TABLE order_events (               -- WAL: se escribe ANTES de la llamada externa
  event_id INTEGER PRIMARY KEY AUTOINCREMENT, intent_id TEXT NOT NULL REFERENCES order_intents,
  from_state TEXT, to_state TEXT NOT NULL, detail_json TEXT, uta_response_json TEXT, at TEXT NOT NULL);

CREATE TABLE fills (
  fill_id TEXT PRIMARY KEY, intent_id TEXT REFERENCES order_intents, broker_order_id TEXT,
  qty TEXT NOT NULL, price TEXT NOT NULL, fee TEXT, fee_currency TEXT, reference_price TEXT,
  slippage_bps REAL, at TEXT NOT NULL, source TEXT NOT NULL);

CREATE TABLE managed_positions (
  position_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, symbol TEXT NOT NULL, strategy_id TEXT NOT NULL,
  side TEXT NOT NULL, qty TEXT NOT NULL, avg_entry TEXT NOT NULL, current_stop TEXT, current_target TEXT,
  protective_order_id TEXT, opened_at TEXT NOT NULL, closed_at TEXT, entry_intent_id TEXT, exit_intent_id TEXT,
  realized_pnl TEXT, bars_held INTEGER, status TEXT NOT NULL);

CREATE TABLE trades (                     -- trade cerrado (para métricas)
  trade_id TEXT PRIMARY KEY, position_id TEXT REFERENCES managed_positions, strategy_id TEXT, symbol TEXT,
  side TEXT, entry_at TEXT, exit_at TEXT, entry_price TEXT, exit_price TEXT, qty TEXT,
  gross_pnl TEXT, fees TEXT, slippage TEXT, net_pnl TEXT, r_multiple REAL, exit_reason TEXT, stage TEXT);

CREATE TABLE equity_snapshots (account_id TEXT, at TEXT, equity TEXT, cash TEXT, gross_exposure TEXT,
  net_exposure TEXT, source TEXT, PRIMARY KEY (account_id, at));

CREATE TABLE reconciliations (recon_id TEXT PRIMARY KEY, at TEXT, account_id TEXT, ok INTEGER,
  diff_json TEXT, action_taken TEXT);

CREATE TABLE kill_switch_events (event_id TEXT PRIMARY KEY, at TEXT, state TEXT, reason TEXT,
  triggered_by TEXT, source TEXT);          -- espejo de lo que reporta UTA

CREATE TABLE backtest_runs (run_id TEXT PRIMARY KEY, strategy_id TEXT, strategy_version TEXT,
  params_hash TEXT, params_json TEXT, dataset_hash TEXT, fill_model_json TEXT, engine_git_sha TEXT,
  window_json TEXT, is_oos INTEGER, metrics_json TEXT, created_at TEXT);

CREATE TABLE backtest_trades (run_id TEXT REFERENCES backtest_runs, trade_json TEXT);

CREATE TABLE stage_promotions (promotion_id TEXT PRIMARY KEY, strategy_id TEXT, strategy_version TEXT,
  from_stage TEXT, to_stage TEXT, gate_results_json TEXT, decided_by TEXT, adr_ref TEXT, at TEXT);

CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, at TEXT, severity TEXT, kind TEXT, message TEXT,
  delivered_json TEXT, acked_at TEXT);

CREATE TABLE heartbeats (component TEXT PRIMARY KEY, at TEXT, detail_json TEXT);
```

Del lado UTA (archivos, fieles a su estilo): `data/trading/_risk/risk-state.json`, `risk-decisions.jsonl`, `data/trading/<id>/pending.json` (M5). El enlace entre ambos mundos es `order_intents.uta_commit_hash` ↔ `GitCommit.hash`.

---

# 19. OBSERVABILITY

[PROPUESTA]

## 19.1 Decision Record (reconstruir "¿por qué compró?")

Consulta `GET /engine/why?symbol=BTCUSDT&at=2026-10-03T14:00:00Z` → une `decisions` + `feature_snapshots` + `regimes` + `llm_advisories` + `order_intents` + `order_events` + `fills` + `trades` + la entrada de `risk-decisions.jsonl` de UTA (por `clientOrderId` o commit) + el `GitCommit` (vía UTA `wallet/show/:hash`).

```json
{
  "timestamp": "2026-10-03T14:00:00Z",
  "asset": "BTCUSDT (bybit-demo-engine)",
  "marketData": { "lastBarClose": "…", "dataAgeSec": 4, "datasetSource": "uta:bybit-demo-engine" },
  "marketRegime": { "label": "TREND_UP", "inputs": { "emaSlopeAtr": 0.42, "volPct": 55 } },
  "strategy": { "id": "trend_following", "version": "1.0.0", "paramsHash": "…" },
  "signal": { "kind": "ENTER", "side": "LONG", "reasonCodes": ["EMA20_X_EMA50_UP", "SLOPE_OK"] },
  "confidence": { "score": 0.64, "definition": "normalized distance EMA fast/slow in ATR" },
  "entry": "…", "stop": "…", "target": "…",
  "positionSize": { "qty": "0.012", "method": "fixed_risk", "riskPct": 0.5 },
  "risk": { "plannedRisk": "…", "uta": { "verdict": "PASS", "policyHash": "…", "rules": ["R0✓", "…"] } },
  "advisory": { "id": "adv_…", "action": "NONE", "mode": "SHADOW" },
  "reason": "Cruce EMA 20/50 alcista en régimen TREND_UP; stop 2.5×ATR",
  "order": { "intentId": "…", "clientOrderId": "oa-…", "type": "LMT", "utaCommit": "a1b2c3d4" },
  "execution": { "state": "FILLED", "avgPrice": "…", "slippageBps": 3.1, "fees": "…" },
  "result": { "exitReason": "TRAILING_STOP", "netPnl": "…", "rMultiple": 1.4 },
  "pnl": { "realized": "…", "unrealizedAtExit": "0" }
}
```

## 19.2 Logs
- `pino` en JSON (ya es dependencia del monorepo [VERIFICADO EN REPOSITORIO]) con los campos `component`, `cycle_id`, `decision_id`, `intent_id`, `account_id`, `symbol`; sin secretos (redacción de claves y tokens).
- Rotación por Docker (`json-file` con `max-size`/`max-file`) o journald.

## 19.3 Métricas y salud
- `GET /engine/health` (liveness), `GET /engine/ready` (datos frescos + UTA alcanzable + reconciliación OK), `GET /engine/metrics` (formato Prometheus opcional): `cycles_total`, `cycle_duration_ms`, `data_age_seconds`, `intents_by_state`, `risk_rejects_total{rule}`, `kill_switch_state`, `equity`, `daily_pnl_pct`, `drawdown_pct`, `unknown_intents`.
- **Dead-man's switch:** el Engine hace ping a un servicio externo de heartbeat cada ciclo; si no llega ping en 2× el intervalo → alerta fuera del sistema (así sabes que el VPS murió).

## 19.4 Alertas (Telegram directo + espejo opcional en el Inbox)
Críticas: kill switch activado, P1 violada, `UNKNOWN`/`NEEDS_HUMAN`, cuenta offline con posición, error de reconciliación, política inválida. Avisos: datos obsoletos, rechazos del Risk Engine, advisory caducado. Diario: resumen de PnL y métricas. **Usar un bot o chat distinto del de aprobaciones** para no mezclar ruido con decisiones.

---

# 20. SECURITY

| Control | Estado actual | Propuesta |
|---|---|---|
| Autenticación de UTA | Ninguna; bind a loopback [VERIFICADO EN REPOSITORIO] | Tokens por cliente con scopes: `read`, `stage`, `approve` (humano), `engine`, `operator` (kill/reset), `simulator` (solo dev/paper). Comparación en tiempo constante. Tokens en archivos 0600 / Docker secrets |
| Endpoint one-shot `wallet/place-order` | Ejecuta sin paso de aprobación [VERIFICADO EN REPOSITORIO] | Requiere scope `approve` u `operator`; el Engine no lo usa |
| Bypass de loopback en Alice | Activo sin proxy de confianza [VERIFICADO EN REPOSITORIO] | En el VPS: acceso a la UI solo por túnel SSH; el Engine no depende de Alice |
| Política de riesgo | Inexistente; guards en config escribible | Archivo del host montado RO en UTA; sin API de escritura |
| Kill switch | Inexistente | Archivo del host RO + endpoint con scope `operator` |
| `allowAiTrading` | Escribible por el usuario del agente | Mantener `false`; UTA ignora el push de la IA si el modo efectivo no lo permite |
| Aislamiento de procesos | Mismo usuario del SO [INFERENCIA] | Contenedores separados (`uta`, `engine`, `alice`) en una red interna; UTA sin puertos publicados |
| Claves de broker | Selladas con AES-GCM; clave en el mismo host [VERIFICADO EN REPOSITORIO] | Solo trading, sin retiros, IP allowlist, sub-cuenta dedicada |
| Secretos en git | Regla del repo [DOCUMENTACIÓN] | `.gitignore` para `deploy/secrets/`, pre-commit con escaneo de secretos (p. ej. gitleaks) |
| Supply chain | `allowBuilds` restrictivo, lockfile [VERIFICADO EN REPOSITORIO] | `pnpm install --frozen-lockfile`; revisar dependencias nuevas |
| Backups | No gestionados | Cifrados (restic/borg) de `uta-home`, `engine-data` y la política |
| Licencia AGPL-3.0 | [VERIFICADO EN REPOSITORIO] | Si se ofrece como servicio a terceros por red, AGPL obliga a publicar el código modificado [INFERENCIA; no es asesoría legal] |

**Riesgo residual declarado:** un agente con shell en el contenedor `alice` podría leer el token de UTA de Alice (mismo UID) y hacer push de operaciones **dentro de la política**. Mitigaciones: el token de Alice no tiene scope `engine`; en modos 5/6 la cuenta del Engine está en `engineOwned` y UTA rechaza staging ajeno en esa cuenta; la política limita el daño. Mitigación futura: ejecutar los PTYs de agentes con otro UID.

---

# 21. DEPLOYMENT

[PROPUESTA] (no existe despliegue de producción en el repo [VERIFICADO EN REPOSITORIO])

## 21.1 VPS
- 2–4 vCPU, 4–8 GB RAM, 40+ GB SSD, Ubuntu LTS, en una región con buena latencia al venue (medir, no suponer).
- `chrony` para sincronizar el reloj (la regla de desfase de reloj depende de esto), `ufw` (solo SSH), `fail2ban`, actualizaciones automáticas de seguridad, usuario sin root para Docker.

## 21.2 Docker Compose (esqueleto; los Dockerfiles se crean en `deploy/`)

```yaml
# deploy/compose.yaml
name: openalice-trading
networks: { internal: { internal: true }, egress: {} }
volumes: { uta-home: {}, alice-home: {}, engine-data: {} }
secrets:
  uta_tokens:    { file: ./secrets/uta-tokens.json }     # 0600, fuera de git
  engine_token:  { file: ./secrets/engine-token }
  telegram_bot:  { file: ./secrets/telegram-bot-token }
services:
  uta:
    build: { context: .., dockerfile: deploy/uta.Dockerfile }
    environment:
      OPENALICE_HOME: /data
      OPENALICE_UTA_BIND_HOST: 0.0.0.0          # M7: solo con tokens obligatorios
      OPENALICE_RISK_POLICY_PATH: /policy/risk-policy.json
      OPENALICE_CONTROL_DIR: /control
    volumes:
      - uta-home:/data
      - /etc/openalice/risk-policy.json:/policy/risk-policy.json:ro
      - /run/openalice-control:/control:ro
    secrets: [uta_tokens]
    networks: [internal, egress]                # egress: API de exchanges
    restart: unless-stopped
    healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:47333/__uta/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: 15s, timeout: 5s, retries: 4 }
  engine:
    build: { context: .., dockerfile: deploy/engine.Dockerfile }
    environment: { ENGINE_UTA_URL: http://uta:47333, ENGINE_DB_PATH: /data/engine.sqlite, ENGINE_MODE: PAPER }
    volumes: [ engine-data:/data, ../services/engine/config:/config:ro ]
    secrets: [engine_token, telegram_bot]
    depends_on: { uta: { condition: service_healthy } }
    networks: [internal, egress]                # egress: Telegram + heartbeat externo
    restart: unless-stopped
    healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:47340/engine/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: 30s, timeout: 5s, retries: 3 }
  alice:
    build: { context: .., dockerfile: deploy/alice.Dockerfile }   # Guardian prod con UTA externo (M9b)
    environment: { OPENALICE_HOME: /data, OPENALICE_UTA_EXTERNAL: "1", OPENALICE_UTA_URL: http://uta:47333, OPENALICE_BIND_HOST: 0.0.0.0 }
    volumes: [ alice-home:/data ]
    ports: [ "127.0.0.1:47331:47331" ]          # UI solo por túnel SSH
    networks: [internal, egress]                # egress: proveedores LLM y de datos
    restart: unless-stopped
```
Notas:
- El contenedor `alice` necesita instalados los CLIs de agente (claude/codex) y sus credenciales para los roles LLM. [DOCUMENTACIÓN: "Source installs need at least one host agent CLI"]
- **Topología de transición** (Fases 2–9): un solo host con `pnpm build` + `node scripts/guardian/prod.mjs` bajo **systemd** (`Restart=always`, `RestartSec=5`) y el Engine como segundo servicio systemd. La topología dividida en contenedores se introduce en la Fase 10.
- En la topología dividida, las cuentas de broker se gestionan del lado de UTA (el operador edita `accounts.json` del volumen `uta-home`); la edición desde la UI de Alice no aplica. Documentarlo.

## 21.3 Operación
- **Restart policies:** `unless-stopped` + healthchecks; M9a reinicia UTA dentro de Guardian cuando corre en modo integrado.
- **Backups:** nightly con `sqlite3 .backup` (o la API de backup) + restic cifrado a almacenamiento externo; retención 7 diarios / 4 semanales / 6 mensuales; **prueba de restauración mensual**.
- **Scheduler:** el reloj del Engine vive en el propio proceso (alineado a cierres de barra); cron del host solo para backups y rotación.
- **Actualizaciones:** tag de imagen fijo; despliegue = `compose pull/build` + `up -d`; **rollback** = volver al tag anterior; las migraciones SQL deben ser compatibles hacia atrás durante una versión (expand/contract).
- **Monitoreo externo:** heartbeat (§19.3) + un uptime check del túnel/host.

---

# 22. DEVELOPMENT ROADMAP

| Fase | Entregable | Tamaño relativo | Gate de salida |
|---|---|---|---|
| 0 Repository audit | `docs/trading-engine/AUDIT.md` que re-verifica este documento contra el commit actual | S | Cada afirmación con archivo y línea; discrepancias listadas |
| 1 Architecture | ADRs (proceso aparte, SQLite, auth UTA, política RO, modos), esqueleto `services/engine` que compila y tiene tests vacíos, `docs/trading-engine.md` | S | Build + typecheck + test en verde; ADRs aprobados |
| 2 Market data | Data store + fetch vía UTA + calidad + frescura + CLI `engine data sync` | M | Tests de huecos/duplicados; barras idénticas en 2 descargas; 0 barras abiertas usadas |
| 3 Strategy engine | Strategy SDK, indicadores en serie, régimen, A–E, agregador, sizer | M | Tests de pureza, no-lookahead, determinismo; valores de indicadores vs referencia |
| 4 Risk engine | RiskEngine en UTA + kill switch + estado + auth (M1–M3, M7, M8) | L | Suite de reglas R0–R20 con casos límite; fail-closed probado; 100 % de ops pasan por RiskEngine |
| 5 Paper trading | PriceFeeder + MockBroker con comisiones/slippage (M10) + ExecutionManager en modo PAPER + monitor | L | E2E en MockBroker: entrada → stop → salida; reinicio a mitad de ciclo sin pérdida |
| 6 Backtesting | Backtester + walk-forward + métricas + gates + informes | M | Mismo trade en backtest y en paper con la misma serie de precios (test de paridad) |
| 7 Execution engine | WAL, idempotencia (M4–M6), reconciliación, modos 4–6 | L | Pruebas de caos; 0 duplicados; `UNKNOWN` siempre resuelto o escalado |
| 8 Testnet | Integración con cuenta demo + S1–S14 del venue | M | Gate §16 |
| 9 Monitoring | Métricas, alertas, heartbeat, `/why` | M | Simulacros de alertas; `/why` reconstruye 100 % de los trades de prueba |
| 10 24/7 deployment | `deploy/` completo, topología dividida (M9), backups, runbook | M | 7 días en VPS sin intervención; restore probado |
| 11 Live trading | Small live con `capitalCap` | — | Gate §17; ADR de promoción firmado |

**Regla:** no se pasa a la siguiente fase si la anterior no cumple sus acceptance tests (§25).

---

# 23. RISKS AND FAILURE MODES

| # | Modo de fallo | Impacto | Mitigación |
|---|---|---|---|
| F1 | Sobreajuste / data snooping | Pérdidas en live | Walk-forward, registro de pruebas múltiples, holdout, gates fijados de antemano |
| F2 | Lookahead (uso de la barra abierta) | Backtest irreal | Solo barras cerradas; test de truncado |
| F3 | Alucinación del LLM | Decisiones erróneas | LLM solo advisory veto/reduce, en sombra hasta probar valor |
| F4 | Datos obsoletos o erróneos | Órdenes a precios equivocados | Frescura (R5), banda de precio (R6), calidad, halt si los datos están obsoletos |
| F5 | Cambios o bugs del API del broker | Órdenes mal formadas o no ejecutadas | S1–S14 en cada actualización; el repo ya encontró ~20 bugs en dogfooding [DOCUMENTACIÓN] |
| F6 | Orden duplicada por reintento | Doble exposición | Sin reintentos de escritura; `clientOrderId`; reconciliación |
| F7 | Caída entre la ejecución en el broker y la escritura del ledger | Orden huérfana | WAL del Engine; `[observed]` de UTA; reconciliación al arrancar |
| F8 | Pérdida del commit pendiente al reiniciar UTA | Aprobación perdida o desincronizada | M5 + expiración de intents |
| F9 | Stop no presente en el venue | Pérdida no acotada | Invariante P1 verificada contra el broker |
| F10 | Fills parciales | Tamaño o stop incorrecto | Protección proporcional a lo llenado; cancelar el remanente |
| F11 | Gap o flash crash que salta el stop | Pérdida > riesgo planificado | Límite de apalancamiento; tamaño conservador; aceptar el riesgo residual y medirlo |
| F12 | Liquidación en derivados | Pérdida total de margen | `maxLeverage` ≤ 1–2 al inicio; margen aislado si el venue lo permite |
| F13 | Funding de perpetuos no modelado | Backtest optimista | Marcado explícito; modelarlo en v2 |
| F14 | Desfase de reloj | Barras o ventanas incorrectas | chrony + regla de desfase |
| F15 | Caída del VPS | Posiciones sin supervisar | Stops en el venue; dead-man's switch; runbook |
| F16 | Agente que evita la aprobación | Trades no autorizados | Auth UTA + política RO + cuenta dedicada (§20) |
| F17 | Filtración de credenciales | Robo o uso de la cuenta | Sin retiros, IP allowlist, sellado, secrets 0600 |
| F18 | Deriva de configuración | Comportamiento no auditado | Hash de config en cada decisión; config en git |
| F19 | Coste de tokens LLM | Gasto inesperado | Roles asíncronos con timeout y presupuesto; frecuencia baja |
| F20 | Operador único ausente | Incidente sin atender | Fail-closed por defecto; alertas; runbook |
| F21 | Upstream OpenAlice cambia rápido | Conflictos en el fork | Cambios mínimos y aislados; rebase frecuente; tests de contrato |
| F22 | Expectativas de rentabilidad | Decisiones emocionales | Gates objetivos; capital cap; ningún "ajuste" fuera de un ADR |

---

# 24. CLAUDE CODE PROMPT MASTER

El Prompt Master está completo en el bloque de abajo y también como archivo aparte (`PROMPT_MASTER_CLAUDE_CODE.md`) para pegarlo directamente en Claude Code. Es autocontenido: incluye los hallazgos de la auditoría, pero obliga a re-verificarlos en la Fase 0.

````markdown
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

````

---

# 25. ACCEPTANCE CRITERIA

Criterios globales del sistema (además de los criterios por fase de la §37 del Prompt Master). Todos [PROPUESTA].

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC1 | Ninguna escritura llega al broker sin pasar por el RiskEngine | Test de integración que recorre las 4 rutas de escritura con un RiskEngine que rechaza todo → 0 llamadas a `broker.placeOrder` |
| AC2 | La IA no puede modificar los límites | La política se monta RO; no existe ruta HTTP de escritura (test que enumera las rutas); un agente de prueba intenta escribir en el archivo → falla |
| AC3 | Fail-closed | Política ausente, inválida o estado corrupto → `HALT_NEW` (tests) |
| AC4 | El kill switch detiene nuevas órdenes de inmediato | Tras activarlo, la siguiente `placeOrder` es rechazada con R0; close y cancel siguen permitidos |
| AC5 | Reproducibilidad | Mismo `run_id` → métricas idénticas byte a byte |
| AC6 | Sin lookahead | Test de truncado en todas las estrategias |
| AC7 | Paridad backtest ↔ paper | Misma serie → mismos trades (tolerancia 0 en la lógica; el slippage se compara aparte) |
| AC8 | Sin órdenes duplicadas | Suite de caos: 0 duplicados en 100 ejecuciones aleatorizadas |
| AC9 | Recuperación | kill -9 de cualquier proceso → vuelve solo y reconcilia en < 2 min |
| AC10 | Auditoría completa | `/why` devuelve los 17 campos del DecisionRecord para el 100 % de los trades |
| AC11 | Gates objetivos | Promover requiere un registro en `stage_promotions` con todos los gates en PASS y un ADR |
| AC12 | 24/7 | 7 días en el VPS sin intervención (heartbeats ≥ 99 %) |
| AC13 | Seguridad | UTA sin token → 401; scope insuficiente → 403; bind no-loopback sin tokens → no arranca |
| AC14 | Sin regresiones | `pnpm test` completo, typecheck del root y de los paquetes tocados, y `pnpm build` en verde |

---

# 26. DEFINITION OF DONE

**Por tarea:** código real (sin stubs en rutas críticas) + tests unitarios e integración + typecheck del owner + build + la guía owner de `docs/` actualizada en el mismo cambio + ADR si hubo decisión + sin secretos + evidencia (comandos ejecutados y salida real).

**Por fase:** todos sus acceptance tests en verde; informe de fase (resumen, archivos, verificación, riesgos residuales); PR revisado; aprobación humana explícita antes de la siguiente fase.

**Del sistema (antes de dinero real):** AC1–AC14 cumplidos; al menos una estrategia ha pasado los gates BACKTEST→PAPER→TESTNET con datos registrados; runbook probado (kill switch, flatten, restore, rotación de claves); política de riesgo conservadora firmada por el operador; `capitalCap` definido; el operador entiende y acepta que **el sistema puede perder todo el capital asignado** y que nada de lo anterior garantiza rentabilidad.

---

## Anexo — Archivos clave citados

`AGENTS.md` · `docs/project-structure.md` · `docs/workspace-issues-and-scheduling.md` · `docs/market-data-architecture.md` · `docs/uta-live-testing.md` · `docs/connector-service.md` · `docs/conversation-provenance.md` · `safe/THREAT_MODEL.md` · `services/uta/src/main.ts` · `services/uta/src/http/routes-trading.ts` · `services/uta/src/http/routes-simulator.ts` · `services/uta/src/domain/trading/{UnifiedTradingAccount.ts, uta-manager.ts, git/TradingGit.ts, git-persistence.ts, order-sync-poller.ts, order-entry.ts, guards/*, brokers/registry.ts, brokers/mock/MockBroker.ts, brokers/ccxt/CcxtBroker.ts}` · `packages/uta-protocol/src/{client/UTAClient.ts, types/broker.ts, brokers/preset-catalog.ts}` · `packages/guardian-runtime/src/restart-backoff.ts` · `scripts/guardian/prod.mjs` · `src/tool/trading.ts` · `src/core/{config.ts, sealing.ts, event-log.ts, tool-call-log.ts}` · `src/services/trading-mode.ts` · `src/services/connector-client/uta-review.ts` · `src/webui/plugin.ts` · `src/workspaces/{service.ts, schedule/scanner.ts, spawn-env.ts}` · `src/domain/analysis/{simulate.ts, indicator/functions/*}` · `src/server/trade-provenance.ts` · `src/workspaces/templates/*/template.json`.
