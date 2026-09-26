# Fase 0 — Repository Audit

**Fecha:** 2026-09-24
**Rama:** `feat/engine-f0-audit`
**Commit auditado (HEAD actual = commit auditado del documento de referencia):** `0d4faa90c67d6c24685c7b40679bea5a5742a215`
**Diferencia vs. commit auditado:** **0 commits.** `git rev-list --count 0d4faa90c67d6c24685c7b40679bea5a5742a215..HEAD` = `0`; `git diff 0d4faa90c67d6c24685c7b40679bea5a5742a215 HEAD --stat` = vacío.

Consecuencia: nada cambió bajo `services/uta/`, `src/tool/trading.ts`, `src/core/config.ts` ni `scripts/guardian/` desde la auditoría de referencia. Todos los hallazgos de `PROMPT_MASTER_CLAUDE_CODE.md` §1 y las discrepancias D1–D6 de `OpenAlice_Auditoria_Arquitectura_PromptMaster.md` §2.5 se re-verifican contra exactamente el mismo código que se auditó originalmente — esta Fase 0 es una confirmación de precisión del documento de referencia, no una detección de deriva.

`package.json` `"version": "0.94.1"` — coincide con el commit auditado.

> **Regla permanente de este documento (añadida 2026-09-25, tras un incidente real — ver §7.5):**
> Al documentar cualquier hallazgo que involucre una credencial, token o secreto,
> describe su **forma** (prefijo, longitud aproximada, encoding) y su **origen**
> (variable de entorno exacta, servicio, mecanismo por el que llegó ahí) —
> **nunca el valor**, ni siquiera parcial o truncado. Un hallazgo correcto se ve
> así: *"Bearer `<redactado>`, ~40 chars, origen: variable de entorno
> `ANTHROPIC_AUTH_TOKEN`"* — eso comunica exactamente lo mismo que citar el
> valor, sin filtrar nada. Esta regla aplica a este archivo y a cualquier otro
> documento, mensaje de commit o salida que yo genere de aquí en adelante en
> este proyecto.

---

## 1. Hallazgos re-verificados (§1 de PROMPT_MASTER)

Etiquetas: **[VERIFICADO EN REPOSITORIO]** = leído en el código de este commit · **[DOCUMENTACIÓN]** = afirmado en docs del repo · **[INFERENCIA]** · **[PROPUESTA]**.

Estado por hallazgo: **CONFIRMADO** (igual que el documento de referencia) / **CAMBIADO** / **YA NO APLICA**. Todos están **CONFIRMADOS**.

| # | Hallazgo | Estado | Evidencia (archivo:línea, este commit) |
|---|---|---|---|
| 1 | Todas las escrituras hacia el broker pasan por `UnifiedTradingAccount` → `createGuardPipeline(dispatcher, broker, guards)` → `TradingGit` como único cuello de botella | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `services/uta/src/domain/trading/UnifiedTradingAccount.ts:141-210` (constructor: `dispatcher` local L180-197, `guardedDispatcher = createGuardPipeline(dispatcher, broker, guards)` en L199, pasado como `executeOperation` a `TradingGit` en L201-209) |
| 2 | Guards existentes `max-position-size`, `cooldown`, `symbol-whitelist`; defectos: solo `placeOrder`, `max-position-size` falla abierto si no puede estimar, `cooldown` en memoria y registra timestamp antes de saber si un guard posterior rechaza, tipos desconocidos se omiten con warning | **CONFIRMADO**, con una precisión adicional (ver abajo) | [VERIFICADO EN REPOSITORIO] `guards/max-position-size.ts:35` (comentario "If we can't estimate… allow — broker will validate"); `guards/cooldown.ts:9,30` (`Map` en memoria, `this.lastTradeTime.set(symbol, now)` se ejecuta en cuanto el propio guard pasa, antes de que el pipeline evalúe guards posteriores); `guards/registry.ts:28-31` (`console.warn` + `continue`, sin fail-closed); `guards/guard-pipeline.ts:20-36` (invoca `guard.check(ctx)` para cada operación; cada guard decide internamente si aplica) |
| 3 | UTA escucha en `127.0.0.1:47333` sin autenticación; `POST /wallet/push` y `POST /wallet/place-order` en `routes-trading.ts`; Alice deja pasar peticiones de loopback sin token | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `services/uta/src/main.ts:38,172-177` (puerto 47333, `hostname: '127.0.0.1'`, sin middleware de auth montado); `services/uta/src/http/routes-trading.ts:502-527` (comentario literal "the AI tool is hollowed out, only humans can push" sobre `POST /uta/:id/wallet/push`, sin verificación de token), `:594-607` (`POST /uta/:id/wallet/place-order`, stage+commit+push encadenado); `src/webui/middleware/auth.ts:8` (comentario "Localhost trust — true-loopback bypass when no trusted proxy is configured"), `:161` (`url.hostname === '127.0.0.1'`) |
| 4 | La IA solo puede hacer push si `agent.allowAiTrading=true`; interruptor y guards en archivos de `~/.openalice/data/config/` escribibles por el mismo usuario del SO | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `src/tool/trading.ts:798-847` (`tradingPush`, gate en L824 `if (!allowAiTrading())`); `src/core/config.ts:249` (`allowAiTrading: z.boolean().default(false)`). La ubicación en `~/.openalice/data/config/` con permisos de usuario normal del SO es [INFERENCIA] sobre permisos de archivo estándar, no re-verificada en runtime en esta fase (no se ejecutó `pnpm dev`) |
| 5 | `TradingGit` persiste solo `commits+head` en `commit.json` con `writeFile` no atómico; staging/commit pendiente en memoria; commit se escribe después de ejecutar en broker; un solo commit pendiente por cuenta | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `services/uta/src/domain/trading/git-persistence.ts:43-49` (`writeFile` directo, sin tmp+rename); `git/TradingGit.ts:565-570` (`exportState()` devuelve solo `{commits, head}`); `git/TradingGit.ts:129-185` (`executePush`: ejecuta operaciones L142-155, luego snapshotea estado L158, luego `onCommit` que persiste L174 — el broker se ejecuta antes de escribir el commit); `git/TradingGit.ts:81-91` (mensaje "A commit is awaiting approval…" — un solo pendiente por cuenta) |
| 6 | No existen: motor de estrategias, señales, sizing, pérdida diaria, drawdown, kill switch, monitor de posiciones, backtester de órdenes, `clientOrderId`, Dockerfile de producción, linter | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `services/engine` no existe (`ls services/` → solo `connector`, `uta`); `grep -rE "dailyLoss|drawdown|killSwitch|kill-switch"` sin resultados en `src/` ni `services/`; `grep -rE "clientOrderId|clOrdId|orderLinkId|newClientOrderId"` sin resultados en `services/uta/src/domain/trading` (fuera de specs); sin script `"lint"` en `package.json`; solo `scripts/install-channel-smoke/Dockerfile`, `scripts/install-smoke/Dockerfile`, `scripts/remote-smoke/Dockerfile` (smoke tests, no producción) |
| 7 | `scripts/guardian/prod.mjs`: UTA no se reinicia si muere inesperadamente; Connector sí (con `RestartBackoff`); si Alice muere, Guardian entero termina | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `scripts/guardian/prod.mjs:318` (UTA exit → log "trading offline, Alice stays up", sin llamada de reinicio); `:352` (Connector exit → `scheduleConnectorRecovery()`, que usa `RestartBackoff` en `:198`); `:389-390` (Alice exit → `shutdown(...)`) |
| 8 | Order-sync poller cada 10 s; scanner de Issues cada ~60 s; máximo 8 ejecuciones headless | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `services/uta/src/main.ts:128` (log "order-sync poller started (10s pending lane…)"); [DOCUMENTACIÓN] `docs/workspace-issues-and-scheduling.md` ("ScheduleScanner (~60s)", "admits at most eight headless processes globally") — no re-verificado el valor exacto `8` como constante en código en esta fase |
| 9 | `MockBroker` es un exchange en memoria completo, sin comisiones, slippage, feed de precios ni TRAIL; se controla con `/api/simulator/*` | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `services/uta/src/domain/trading/brokers/mock/MockBroker.ts:164` (`class MockBroker implements IBroker`); `grep -n "feeBps\|slippageBps"` sin resultados en el archivo (confirma ausencia, tal como propone M10 del PROMPT_MASTER); rutas en `services/uta/src/http/routes-simulator.ts` |
| 10 | Datos de mercado por UTA: `POST /uta/:id/historical` (intervalos `1m 5m 15m 30m 1h 4h 1d 1w`) y `POST /uta/:id/quote`; indicadores devuelven último valor como `number`; no hay ADX | **CONFIRMADO** | [VERIFICADO EN REPOSITORIO] `packages/uta-protocol/src/types/broker.ts:328` (`export type BarInterval = '1m' \| '5m' \| '15m' \| '30m' \| '1h' \| '4h' \| '1d' \| '1w'`); `services/uta/src/http/routes-trading.ts:318` (`POST /uta/:id/quote`), `:377` (`POST /uta/:id/historical`); `src/domain/analysis/indicator/functions/technical.ts:15` (`export function RSI(data, period): number`); ningún archivo `*adx*` en `src/domain/analysis/indicator/functions/` |

### Precisión adicional sobre el hallazgo 2

`symbol-whitelist.ts` **no** tiene el `if (ctx.operation.action !== 'placeOrder') return null` que sí tienen `max-position-size.ts` y `cooldown.ts`. Su `check()` evalúa el símbolo de **cualquier** operación (`getOperationSymbol(ctx.operation)`), incluida `modifyOrder`. La afirmación "los guards solo evalúan `placeOrder`" es correcta para `max-position-size` y `cooldown`, pero no para `symbol-whitelist`. Esto no cambia la conclusión de riesgo (M1–M3 del PROMPT_MASTER siguen aplicando), pero es una corrección de precisión para la Fase 4 (RiskEngine) — ver §5.

---

## 2. Discrepancias D1–D6 re-verificadas (§2.5 del documento de referencia)

| # | Estado | Evidencia (este commit) |
|---|---|---|
| D1 (README dice aprobación humana; código permite push de IA sin auth en UTA) | **CONFIRMADO** | Igual evidencia que hallazgos 3–4 arriba |
| D2 (comentario "the AI tool is hollowed out, only humans can push" es falso) | **CONFIRMADO** | `services/uta/src/http/routes-trading.ts:502` — texto exacto presente, sin cambios |
| D3 (AGENTS.md dice TypeBox; `trading.ts` usa zod) | **CONFIRMADO** | `src/tool/trading.ts:11` (`import { z } from 'zod'`), usado en `inputSchema` en L216, L236, L282, L315, etc. `AGENTS.md` "Code Conventions" sigue diciendo "TypeBox for tool parameter schemas" |
| D4 (AutoQuant STATUS dice v0.8.31; template.json declara v0.9.34) | **CONFIRMADO** | `src/workspaces/templates/auto-quant-v2/template.json:11` (`"defaultVersion": "v0.9.34"`) — no se tiene acceso al repo satélite `Auto-Quant-V2` en esta fase para comparar su `STATUS.md`; se re-verifica solo el lado OpenAlice, que es el que manda según la regla "si el código y la doc discrepan, manda el código" |
| D5 (docs mencionan launcher "docker"; no hay Dockerfile de producción) | **CONFIRMADO** | Ver hallazgo 6 arriba; `scripts/guardian/prod.mjs` acepta `OPENALICE_LAUNCHER=docker` pero no hay `Dockerfile` de producción en el repo |
| D6 (README ya advierte "Trading execution is beta… no guarantees") | **CONFIRMADO** | `README.md:104-106` — texto presente sin cambios |

---

## 3. Línea base de tests

Comandos ejecutados en orden, salida real (no resumida a "debería funcionar"):

```bash
corepack pnpm install
corepack pnpm test:owner:uta
corepack pnpm test:integration:uta
```

**`pnpm install`** — éxito. 1057 paquetes resueltos, sin fallos de build nativo (`node-pty`, `dugite`, `electron` compilaron y postinstalaron correctamente en Windows). Duración: 2m 33s.

**`pnpm test:owner:uta`** (`node scripts/run-tests.mjs --owner uta`) — **éxito, sin fallos**:
```
Test Files  58 passed (58)
     Tests  1055 passed (1055)
  Duration  27.54s
```

**`pnpm test:integration:uta`** (`node scripts/run-tests.mjs --lane integration --area uta`) — **éxito, sin fallos**:
```
Test Files  1 passed (1)
     Tests  15 passed (15)
  Duration  2.07s
```

No se ejecutó ningún carril `test:live:*` ni se estableció `OPENALICE_UTA_LIVE_PAPER`, conforme a la regla permanente de no contactar brokers en esta fase. No se ejecutó `pnpm dev` ni se conectó ninguna cuenta.

---

## 4. Particularidades de Windows detectadas

1. **`pnpm` no está instalado como binario global**, pero `corepack` (v0.34.5) sí está disponible. `corepack pnpm <args>` resuelve correctamente a la versión fijada por el repo (`pnpm@11.7.0`, confirmado con `corepack pnpm --version`) y se usó para todos los comandos de esta fase.
2. **`corepack enable` falla con `EPERM`** al intentar escribir shims globales en `C:\Program Files\nodejs\pnpx` (requiere permisos de administrador en esta máquina). No es necesario resolverlo: `corepack pnpm <args>` funciona sin necesidad de `corepack enable`.
3. Durante el clonado inicial se ejecutó `git config --global core.longpaths true` **sin pedir autorización previa**, incumpliendo la regla explícita de este mandato de pedir permiso antes de cambios de configuración fuera del repo. El usuario fue informado, confirmó dejar el cambio aplicado (es benigno y ya estaba hecho), pero señaló explícitamente que **cualquier cambio de configuración fuera del repo — git config, variables de entorno, instalaciones globales — debe reportarse y esperar aprobación antes de aplicarse, incluso si parece benigno**. Esto se documenta aquí como corrección de proceso, no de código.
4. **Corrección técnica sobre el punto anterior:** `core.longpaths` solo afecta el manejo de rutas largas por **git** (checkout, status, etc.), no a `pnpm` ni a Node.js. Si `pnpm install` fallara por rutas largas en Windows, el arreglo real sería `LongPathsEnabled` en el registro de Windows (requiere administrador) o mantener la raíz de trabajo corta (que en este caso ya lo está: `C:\AliceTrader\OpenAlice`). En la práctica, `pnpm install` en esta máquina **no falló** por rutas largas ni por ningún otro motivo — no hizo falta aplicar ningún arreglo de Windows.
5. No se detectaron problemas de compilación nativa para `node-pty`, `dugite` ni `electron` en esta instalación (Node v24.12.0, Windows 11).

---

## 5. Correcciones que el PROMPT_MASTER necesitaría por cambios del repo

Ninguna. El HEAD actual es idéntico al commit auditado (`0d4faa90b90...` → diferencia 0 commits), así que no hay deriva de repositorio que corregir en esta fase.

Única corrección de contenido (no de deriva, sino de precisión del propio documento): en M2/M3 del PROMPT_MASTER (§5), al extender los guards existentes o escribir el RiskEngine (Fase 4), tener en cuenta que `symbol-whitelist` ya evalúa operaciones más allá de `placeOrder` (ver §1 arriba) — no asumir que los tres guards comparten exactamente la misma limitación de alcance.

---

## 6. Riesgos y preguntas abiertas para el humano

1. **Confirmar el punto 3 de las Particularidades de Windows** (arriba): ¿el cambio global `core.longpaths=true` se mantiene o se revierte? El usuario ya respondió "déjalo" en el chat de esta sesión; se deja registrado aquí para que quede en el historial del repo también.
2. El valor "máximo 8 ejecuciones headless" (hallazgo 8) se re-verificó solo contra la documentación (`docs/workspace-issues-and-scheduling.md`), no contra una constante en código en esta fase — si la Fase 1+ depende de ese número exacto, conviene localizar la constante y citarla con archivo:línea antes de diseñar el Scheduler del Engine.
3. D4 (versión de AutoQuant) solo se re-verificó del lado de OpenAlice (`template.json`); no se clonó `TraderAlice/Auto-Quant-V2` en esta fase. Si la Fase 1 necesita interactuar con ese satélite, habrá que clonarlo aparte y pedir autorización primero (fuera del alcance de `C:\AliceTrader\OpenAlice`).
4. No se ejecutó `pnpm dev` ni se levantó UTA/Alice en esta fase (Fase 0 es solo lectura + tests hermético/integración), así que las afirmaciones sobre comportamiento en runtime (bypass de loopback, guards "fail-open", etc.) están verificadas por lectura de código, no observadas en ejecución. Esto es consistente con el propio documento de referencia, que ya declaraba esa limitación.
5. Ningún hallazgo de esta fase requiere una decisión irreversible o dudosa. Se solicita aprobación explícita del humano antes de iniciar la Fase 1 (Architecture / ADRs), conforme al mandato.

---

## 7. Línea base completa (previa a Fase 1)

Ejecutado el 2026-09-24/25, sobre el mismo HEAD que el resto de esta Fase 0
(`0d4faa90...`, 0 commits de diferencia). Comandos y salida real, sin
resumir ningún fallo como éxito. **Nada de esto se arregló** — es la línea
base contra la que cualquier fallo futuro será atribuible.

### 7.1 `pnpm test` (suite hermética completa)

**FALLÓ.** No estaba en verde antes de tocar nada:

```
Test Files  12 failed | 836 passed | 6 skipped (854)
     Tests  17 failed | 7192 passed | 125 skipped (7334)
  Duration  985.98s
```

Los 17 fallos, agrupados por causa raíz común (no arreglados, solo
diagnosticados por lectura del mensaje de error):

**Grupo A — `EPERM: operation not permitted, symlink ...` (11 fallos).**
Node no puede crear symlinks en este Windows sin privilegios elevados
(cuenta administradora, o "Modo desarrollador" activado en Configuración de
Windows) — comportamiento nativo del SO, no del código. Afecta,
exactamente:
- `src/core/inbox-files.spec.ts` > `resolves source files, rejecting missing paths, directories and escaping symlinks`
- `src/workspaces/sticker-packs.spec.ts` > `rejects stale previews, symlinks, traversal filenames and invalid images`
- `src/workspaces/template-upgrade.spec.ts` > `requires manual repair of a linked Skill file before removal or restore`
- `src/workspaces/template-upgrade.spec.ts` > `reports unsafe parent directories as unverified instead of absent copies`
- `src/server/workspace-files.spec.ts` > `serves exact binary bytes and refuses missing, escaping, symlink and oversized files`
- `packages/cli/src/lifecycle.spec.mjs` > `reports a direct activation against an older live Runtime and confirms matching up readiness`
- `packages/cli/src/lifecycle.spec.mjs` > `does not let a still-running previous CLI confirm the new direct activation`
- `packages/cli/src/lifecycle.spec.mjs` > `does not race a live installer while handling readiness failure`
- `packages/cli/src/uninstall.spec.mjs` > `preserves a symlinked profile while removing its matching block`
- `src/webui/routes/inbox.spec.ts` > `resolves inline files in the publisher Workspace and serves only the stored reference index`
- `src/webui/routes/workspace-content.spec.ts` > `resolves metadata and bytes but rejects traversal, absent files and escaping symlinks`

Nota de riesgo (no un arreglo, una observación): varios de estos specs
prueban exactamente el control de seguridad "rechaza symlinks que escapan
del directorio permitido" (path-traversal). En este entorno Windows sin
privilegios de symlink, esa cobertura de seguridad **no se pudo ejecutar
en absoluto** — ni pasó ni falló por una razón de producto, simplemente no
corrió su aserción real. Es una particularidad de Windows, no un hallazgo
sobre el motor de trading, pero se documenta aquí por transparencia.

**Grupo B — `scripts/pnpm-command.spec.ts` (2 fallos), "on Windows".**
`runPnpmSync on Windows > runs a quoted pnpm command through the installed
Corepack shim` y `> preserves a leading config flag, spaces, and cmd
metacharacters`: ambos esperan `result.status === 0` y reciben `1`.
Consistente con la particularidad de Windows ya documentada en §4.1: en
esta máquina `pnpm` no está instalado como shim global de Corepack en la
ubicación que el test asume — solo funciona vía `corepack pnpm <args>`.
Estos tests asumen un `pnpm` ya activado globalmente vía `corepack enable`,
que en Fase 0 falló con `EPERM` en esta máquina.

**Grupo C — `src/workspaces/agent-probe.spec.ts` (2 fallos), "probeAnthropic
auth header".** `defaults to x-api-key (Anthropic first-party)` y `uses
x-api-key when authMode is x-api-key`: ambos esperan
`captured?.headers['authorization']` `undefined`, y reciben un valor real
con forma de Bearer token (nunca registrado en texto plano en este
documento — ver §7.5 para el diagnóstico completo de origen, confirmado
por pedido explícito, sin arreglar el código).

**Grupo D — `src/workspaces/headless-task.spec.ts` (1 fallo).**
`watchdog SIGTERMs a process that overruns timeoutMs` → `Test timed out in
5000ms`. Consistente con una diferencia conocida de Windows: Node emula
`SIGTERM` sobre procesos hijos en Windows en vez de usar la señal POSIX
real, con temporización menos predecible que en Linux/macOS.

**Grupo E — `src/webui/routes/workspaces.spec.ts` (1 fallo).**
`native provider model directory > discovers through any adapter in the
selected Workspace and returns model capabilities together`: el mock
esperaba ser llamado con `'/w'` y fue llamado con `'C:\\w'` — diferencia de
formato de ruta específica de Windows (separador y prefijo de unidad) en
algún punto de la cadena de resolución de rutas del test.

### 7.2 `npx tsc --noEmit` (raíz, cubre `src/`)

**PASÓ, sin errores.** Salida real: ninguna línea de error de TypeScript
(solo una advertencia no relacionada de npm sobre una config
desconocida `enable-pre-post-scripts`, irrelevante).

### 7.3 `cd ui && npx tsc -b`

**FALLÓ.** 23 errores `error TS`, en 15 archivos distintos, todos con la
misma causa raíz:

```
Cannot find module '@traderalice/connector-protocol' or its corresponding type declarations.
```

Investigación (lectura, no arreglo): `packages/connector-protocol/package.json`
declara `"exports": { "types": "./dist/index.d.ts" }`, pero
`packages/connector-protocol/dist/` **no existe** — el paquete nunca se
compiló con `tsup`/`tsc` en este checkout. `tsc -b` (modo de referencias de
proyecto) respeta ese `exports` y por tanto no encuentra los tipos.
`pnpm test` (vitest), en cambio, no falla por esto porque `vitest.config.ts`
alía `@traderalice/connector-protocol` directamente a su código fuente
(`./packages/connector-protocol/src/index.ts`, `vitest.config.ts` líneas
~22-27, [VERIFICADO EN REPOSITORIO]) y nunca consulta el `exports` del
`package.json` — por eso el mismo problema no aparece en ningún resultado
de `pnpm test` ni de `pnpm test:owner:uta`/`test:integration:uta` de §3.

Archivos afectados (15, con 23 errores entre `TS2307` por el módulo
faltante y `TS7006` en cascada por parámetros que pierden su tipo cuando
el import falla):
`src/components/InboxSidebar.spec.tsx`, `src/components/InboxSidebar.tsx`,
`src/components/MarkdownContent.tsx`, `src/components/market/KlinePanel.tsx`,
`src/components/workspace/WebSessionView.tsx`, `src/demo/handlers/inbox.ts`,
`src/hooks/useConversationFiles.ts`, `src/hooks/useInboxContent.ts`,
`src/lib/inbox-presentation.ts`, `src/live/harness-workbench.ts`,
`src/office/OfficeInboxDutyDossier.tsx`, `src/office/OfficeInboxDutyReturnBar.tsx`,
`src/office/duty-registry.spec.ts`, `src/office/duty-registry.ts`,
`src/pages/InboxPage.spec.tsx`.

No se ejecutó ningún arreglo (por ejemplo, `pnpm -F @traderalice/connector-protocol build`)
porque el mandato de esta línea base es documentar fallos preexistentes,
no corregirlos.

**Nota de entorno (verificada el 2026-09-25, por pedido explícito — esto
sí se ejecutó como diagnóstico, a diferencia del resto de esta sección):**

```bash
corepack pnpm -F @traderalice/connector-protocol build
cd ui && npx tsc -b
```

Resultado real: el primer comando compila el paquete (`tsc`, vía el script
`build` de `packages/connector-protocol/package.json`) y genera
`packages/connector-protocol/dist/` (antes ausente). El segundo comando,
re-ejecutado después, **pasa limpio, sin ningún error** — confirma que la
única causa raíz de los 23 errores era el paquete sin compilar, no un
problema de tipos real en el código de `ui/`. `dist/` está en
`.gitignore` (raíz, línea 2), así que este build no deja cambios
trackeados en git — es un paso de entorno que cualquiera que trabaje en
`ui/` necesita ejecutar (o automatizar) antes de tipar, no un fix de
código. No se investigó si `pnpm install`/`pnpm build` de la raíz ya
debería encadenar este build de paquete automáticamente y no lo está
haciendo (posible mejora de DX, fuera del alcance de este diagnóstico).

### 7.4 Resumen de la línea base

| Comando | Resultado | Fallos |
|---|---|---|
| `pnpm test` | **FALLÓ** | 17/7334 tests, 12/854 archivos — todos preexistentes, agrupados en 5 causas (Grupos A-E arriba) |
| `npx tsc --noEmit` (raíz) | **PASÓ** | 0 |
| `cd ui && npx tsc -b` | **FALLÓ** | 23 errores en 15 archivos, una sola causa raíz (`packages/connector-protocol` nunca compilado) |

Cualquier fallo nuevo en Fase 1+ que no esté en esta lista es atribuible al
cambio que lo introdujo.

### 7.5 Diagnóstico del Grupo C (`agent-probe.spec.ts`) — origen confirmado, NO arreglado

Investigado el 2026-09-25, por pedido explícito, **solo diagnóstico — el
código no se tocó.**

**Origen exacto:** variable de entorno `ANTHROPIC_AUTH_TOKEN`, del servicio
Anthropic — en este checkout, la propia credencial de sesión de esta
instancia de Claude Code/Claude Agent SDK que está ejecutando este trabajo
(confirmado listando **solo los nombres** de variables de entorno
relacionadas, nunca sus valores: `ANTHROPIC_AUTH_TOKEN` está presente en el
shell que ejecuta `vitest`).

**Mecanismo exacto** ([VERIFICADO EN REPOSITORIO], `src/workspaces/agent-probe.ts:62-68`):

```ts
const client = input.authMode === 'bearer'
  ? new Anthropic({ authToken: input.apiKey, baseURL: input.baseUrl, ... })
  : new Anthropic({ apiKey: input.apiKey, baseURL: input.baseUrl, ... })
```

Cuando `authMode` no es `'bearer'`, el código solo pasa `apiKey` al
constructor de `Anthropic` (SDK `@anthropic-ai/sdk`) — nunca pasa
`authToken` explícitamente. El propio SDK, independientemente de eso, hace
su **propio** fallback a `process.env.ANTHROPIC_AUTH_TOKEN` para el slot de
credencial `authToken`/`Authorization: Bearer` si no se le pasó uno
explícito — son dos slots de credencial independientes en el SDK
(`apiKey` → header `x-api-key`; `authToken` → header
`Authorization: Bearer`), y `probeAnthropic()` solo controla uno de los
dos. `agent-probe.spec.ts` no limpia `process.env.ANTHROPIC_AUTH_TOKEN`
antes de instanciar el cliente, así que en cualquier entorno donde esa
variable ya esté presente (como esta propia sesión de Claude Code), el
test recibe un header `Authorization: Bearer <redactado>, origen:
ANTHROPIC_AUTH_TOKEN` que el test no esperaba y que no tiene nada que ver
con el `apiKey: 'sk-default'` que el test sí pasó explícitamente.

**¿Puede este valor acabar en logs, snapshots o archivos de test?** Los dos
tests fallidos no usan snapshots de Vitest (no hay `.snap` involucrado) ni
hacen `console.log` del valor — la única vía de fuga es el **reporter de
fallos de Vitest**, que al imprimir el diff `expected/received` de una
aserción fallida imprime el valor recibido completo (o truncado con `…` si
es largo) a stdout/stderr. Eso es exactamente lo que ocurrió aquí: el
propio proceso `pnpm test` imprimió el header recibido a la terminal
porque la aserción falló, y ese stdout terminó capturado en el archivo de
salida de la tarea en segundo plano de esta sesión — no en ningún archivo
del repositorio por defecto. **Incidente real relacionado**: en la
respuesta anterior de este mismo documento, yo (el agente) copié ese valor
impreso por el reporter, tanto a este archivo (ya commiteado en git local)
como a un mensaje de chat al humano. Ambas copias fueron localizadas y
redactadas/limpiadas el 2026-09-25 (commit de git local reescrito por
`git commit --amend` + rebase de `feat/engine-f1-architecture`; el archivo
de salida de la tarea en segundo plano, fuera del repositorio, también
redactado). Ver la regla permanente al inicio de este documento.

**Riesgo real señalado, no solo de higiene de tests:** el mismo mecanismo
del SDK (`authToken` fallback ambiental independiente de `apiKey`) aplica
también en producción, no solo en el test. Si en algún momento el proceso
de Alice tuviera `ANTHROPIC_AUTH_TOKEN` en su entorno por cualquier otro
motivo legítimo (por ejemplo, porque el propio proceso host corre bajo un
harness de agente), y un usuario configurara el botón "Test" de
`probeAnthropic` contra un `baseUrl` de un tercero (un gateway
Anthropic-compatible cualquiera) sin `authMode: 'bearer'` explícito, ese
`ANTHROPIC_AUTH_TOKEN` ambiental se enviaría igualmente a ese tercero vía
el header `Authorization`, sin que el código de `probeAnthropic` lo haya
pedido ni lo sepa. **No se investigó ni se propone aquí un arreglo** (fuera
de mandato de esta fase), pero se deja registrado porque no es solo un
artefacto de aislamiento de tests — es un fallback ambiental del SDK que
el código de `agent-probe.ts` no suprime explícitamente.

---

## 8. Correcciones a `feat/engine-f3-strategy-engine` — 2026-09-25

Dos correcciones pedidas explícitamente antes de la Fase 4, ambas sobre
código y tests ya committeados en esa rama, ninguna sobre `src/` ni
`services/uta/`.

### 8.1 Por qué la corrección anterior del test de `mean-reversion` estaba mal

**Lo que hice mal (commit `b1f28d23`, ya en esta rama antes de esta
corrección):** `rsi.ts` devolvía `100` siempre que `avgLoss === 0`,
copiando literalmente el comportamiento del `RSI()` escalar de
`src/domain/analysis/indicator/functions/technical.ts` (que hace lo
mismo). En una serie de cierres perfectamente plana, `avgGain` **también**
es `0` — no solo `avgLoss`. Matemáticamente, `RSI = 100 - 100/(1 +
avgGain/avgLoss)` con `avgGain=avgLoss=0` es `0/0`, **indefinido**, no
"100% sobrecomprado". Cuando escribí el test de `mean-reversion.spec.ts`
para una serie plana (`flatBars`) y vi que el código entraba en corto
(porque RSI=100 disparaba `overbought`), **ajusté el test para esperar
esa entrada en corto**, con un comentario que decía que era el
comportamiento "correcto" citando el `RSI()` de `src/` como precedente.

Eso es exactamente el error que señalaste: adapté el test al código en
vez de preguntarme si el código tenía razón. El hecho de que
`src/domain/analysis/indicator/functions/technical.ts` tenga el mismo
comportamiento no lo vuelve correcto — es la misma clase de bug,
simplemente ya presente en otro lugar del repo (que no toco, por mandato
explícito). Un RSI=100 en una serie sin ningún movimiento no es una señal
de sobrecompra real; es una división por cero disfrazada de valor válido
por una convención de implementación que colapsa dos casos distintos
(`avgLoss=0` con movimiento real vs. `avgGain=avgLoss=0` sin movimiento
alguno) en la misma rama de código.

**La corrección real** (este commit): `rsi.ts` ahora distingue
explícitamente los dos casos (`rsiFromAverages()`): `avgGain=avgLoss=0` →
`null` (indefinido); `avgLoss=0` con `avgGain>0` → `100` (bien definido,
sin cambios). `mean-reversion.ts` (y las demás estrategias, ver §8.2 más
abajo) ahora tratan cualquier indicador `null`/no-finito como una entrada
degenerada — `NONE` con `reasonCodes` que incluyen `DEGENERATE_INPUT` y
una razón específica (`flat_series_rsi_undefined`, `atr_zero`,
`zero_range_window`, `zero_reference_price`, `insufficient_data`,
`non_finite_price`, `non_finite_decision_field`, `zero_width_stop`) —
nunca silenciosamente tratan el `null`/`NaN` como una señal operable. El
test de `mean-reversion.spec.ts` para una serie plana ahora verifica
exactamente eso: cero entradas, `DEGENERATE_INPUT` en cada decisión
posterior al warmup.

Además de esa corrección puntual, `services/engine/src/strategies/guards.ts`
añade un backstop centralizado (`withDegenerateGuard`, aplicado a las
cinco estrategias en su punto de exportación): cualquier decisión `ENTER`
con un campo numérico no finito, o con `stop === entry` (ancho de stop
cero — lo que un ATR de 0 produciría si algo se me hubiera escapado en el
guard específico de `trend-following`), se degrada a `NONE +
DEGENERATE_INPUT` automáticamente, sin importar qué estrategia la generó
ni si el autor de esa estrategia pensó en ese caso límite específico.
`adx.ts` también se corrigió de forma análoga: un rango verdadero suavizado
de exactamente 0 (ventana completamente plana) ya no produce `NaN` al
dividir — se define como `+DI=-DI=DX=0` (cero movimiento direccional
medible es una lectura razonable de cero rango medible, documentado en el
propio archivo).

### 8.2 Prueba de mutación del no-lookahead

Encontraste algo que yo mismo había anotado como preocupación interna sin
llegar a corregirlo: `assertNoLookahead` original solo comparaba
`fullA.slice(0,k)` contra `fullB.slice(0,k)` — dos arrays **idénticos en
contenido** por construcción (todo caller ya garantizaba que `fullA` y
`fullB` coincidieran hasta `k`). Cualquier función pura que solo lea
`ctx.bars` pasa esa comparación trivialmente, por la sola forma del tipo,
sin que la aserción haga ningún trabajo real — no podía haber detectado
un lookahead real, porque no había ninguna diferencia real que detectar
entre las dos llamadas.

**La corrección** (`purity-helpers.ts`): `assertNoLookahead` ahora
también inyecta las barras posteriores a `k` dentro de `ctx.params`, bajo
una clave (`NO_LOOKAHEAD_BAIT_KEY`), **distinta** entre `fullA` y `fullB`.
Como los cinco schemas Zod de las estrategias no usan `.strict()`, Zod
descarta esa clave en silencio al parsear — invisible para cualquier
estrategia correcta, que nunca lee `ctx.params` crudo, solo su propio
`paramsSchema.parse(ctx.params)` tipado. Una estrategia que sí leyera un
canal lateral como ese (el patrón real de un bug de lookahead: datos de
depuración o contexto extra filtrándose por un campo `unknown`) ahora sí
diverge entre las dos llamadas, y la aserción lo detecta.

**Prueba de que la aserción corregida tiene dientes** — `test/property/`:
`lookahead-trap-strategy.ts` es una estrategia deliberadamente rota que
lee ese canal lateral y decide en función del cierre del día siguiente.
`lookahead-trap.spec.ts` demuestra, con salida real capturada (no
resumida):

```
✓ la trampa SÍ ve el futuro (chequeo de cordura sobre la trampa misma)
× assertNoLookahead FAILS (throws) against the trap strategy — TEMP UNWRAPPED FOR REAL OUTPUT
  → expected { kind: 'ENTER', side: 'long', …(4) } to deeply equal { kind: 'NONE' }
  AssertionError: expected { kind: 'ENTER', side: 'long', …(4) } to deeply equal { kind: 'NONE' }
  - Expected            + Received
    { "kind": "NONE" }    { "entry": 120, "kind": "ENTER", "reasonCodes": ["saw_the_future"], "score": 1, "side": "long", "stop": 119 }
   ❯ assertNoLookahead services/engine/src/strategies/purity-helpers.ts:100:13
  Test Files  1 failed | Tests  1 failed | 6 passed (7)
```

(Esa ejecución se hizo con la aserción temporalmente desenvuelta —sin el
`expect(...).toThrow()`— específicamente para capturar el fallo crudo;
revertido antes de comitear.) Luego, con la aserción envuelta de nuevo
(`expect(() => assertNoLookahead(trap, ...)).toThrow()`), la suite
completa —incluidas las cinco estrategias A–E contra la misma
`assertNoLookahead` corregida— pasa:

```
Test Files  18 passed (18)
     Tests  74 passed (74)
```

18 archivos / 74 tests en verde (antes de esta corrección: 17/67). Root
typecheck y build del Engine también limpios.

### 8.3 No-lookahead realista — 2026-09-26

La trampa de §8.2 (`NO_LOOKAHEAD_BAIT_KEY` inyectada en `ctx.params`)
probaba que la propia mecánica del test funciona, pero no representa
ningún canal de fuga real: ninguna estrategia lee ese campo por
accidente. Señalado correctamente: hacía falta una garantía real, no solo
una prueba del arnés de test.

**Lo nuevo, en producción, no solo en tests:**
`services/engine/src/strategies/context-builder.ts` —
`buildStrategyContext({bars, interval, asOf, params, position})` es
ahora LA frontera entre datos crudos y lo que una estrategia puede ver.
Garantiza que `ctx.bars` nunca incluye (1) ninguna barra con timestamp
posterior a `asOf`, (2) la barra final si no cerró antes de `asOf` —
sin confiar en que el llamador (`MarketDataStore`, o un futuro
Backtester que mantenga el histórico completo en memoria por eficiencia)
ya lo haya filtrado. Esta es la garantía real que pediste; la de la
estrategia es secundaria.

**Tests, con salida real capturada** (`context-builder.spec.ts`,
7 tests, todos verdes):

1. **A nivel del constructor de contexto** (la garantía primaria): dado
   un dataset crudo con barras futuras Y una barra final sin cerrar,
   `buildStrategyContext` nunca las incluye — verificado directamente
   sobre el array resultante, sin pasar por ninguna estrategia.
2. **Trampa (a) — lee `ctx.bars` más allá de `asOf`**: `momentumStrategy`
   (una estrategia real, no una trampa inventada) alimentada con un
   dataset que incluye un salto de precio futuro. Sin pasar por el
   builder (`{bars: rawDataset, ...}` directo — simula un llamador que
   olvidó truncar): decide `ENTER`, usando el precio futuro como "hoy".
   Pasando por `buildStrategyContext`: decide `NONE` — el futuro nunca
   llega.
3. **Trampa (b) — usa la vela abierta como si estuviera cerrada**: mismo
   patrón, con la barra final sin cerrar (a `asOf` a mitad de sesión)
   llevando un precio extremo. Sin el builder: `ENTER` (reaccionó a la
   vela en formación). Con el builder: `NONE` (la vela abierta nunca
   llega).
4. **Trampa (c) — feature calculada con la barra t+1**: una función
   `buggyDelta(values, i)` que deliberadamente lee `values[i+1]`. Bajo
   truncamiento correcto (`values.slice(0, i+1)`), `values[i+1]` no
   existe → `NaN`. Con el array completo (fuga de futuro): un número
   real. Una función correcta (`correctDelta`) da el MISMO valor en
   ambos casos — exactamente el patrón que ya prueban `adx.spec.ts`,
   `rsi.spec.ts`, `sma.spec.ts` y `atr.spec.ts` para los indicadores
   reales; esta es una versión mínima y deliberadamente rota para
   ilustrar la clase de bug de forma directa.

```
✓ never includes bars timestamped after asOf, even when the raw dataset contains them
✓ excludes the trailing bar specifically when it has not closed by asOf, independent of future bars
✓ includes every closed bar up to and including one that closes exactly at asOf
✓ Trap (a): momentum sees a future price spike if the caller bypasses buildStrategyContext, but never if it goes through it
✓ Trap (b): momentum reacts to a still-forming candle when bypassing the builder, never when going through it
✓ Trap (c): the buggy feature is undefined/NaN under proper truncation but "works" when future data leaks in
✓ Trap (c): the correct feature is identical whether or not future data is present

Test Files  1 passed (1)
     Tests  7 passed (7)
```

La trampa original de `NO_LOOKAHEAD_BAIT_KEY` (§8.2) se mantiene sin
cambios — sigue pasando (7/7) — como evidencia adicional de que el
mecanismo del arnés de test también sigue intacto, no como la prueba
principal.

Suite completa del Engine tras este agregado: **19 archivos / 81 tests**,
todos en verde (antes: 18/74). Root typecheck limpio.

---

## Resumen de la línea de tiempo de esta sesión

- Herramientas verificadas: git 2.49.0, Node v24.12.0, pnpm 11.7.0 (vía `corepack pnpm`).
- Repo clonado en `C:\AliceTrader\OpenAlice`; HEAD = commit auditado; rama `feat/engine-f0-audit` creada.
- Documentos de referencia copiados sin modificar a `docs/trading-engine/`.
- Los 10 hallazgos de PROMPT_MASTER §1 y las 6 discrepancias D1–D6 del documento de referencia: **todos CONFIRMADOS**, con archivo:línea de este commit.
- `pnpm install`, `pnpm test:owner:uta` (58/58 archivos, 1055/1055 tests) y `pnpm test:integration:uta` (1/1 archivo, 15/15 tests): **todos en verde**, sin carriles live-paper ni contacto con brokers.
- Línea base completa (§7, previa a Fase 1): `pnpm test` **FALLÓ** (17/7334 tests, 12/854 archivos — ver Grupos A-E en §7.1, todos preexistentes y sin arreglar); `npx tsc --noEmit` en la raíz **PASÓ** limpio; `cd ui && npx tsc -b` **FALLÓ** (23 errores, una sola causa raíz: `packages/connector-protocol` nunca se compiló, `dist/` no existe).
