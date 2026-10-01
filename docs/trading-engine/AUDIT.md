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

## 9. Fase 4a — RiskEngine (`feat/engine-f4a-risk-engine`) — 2026-09-25

Primera fase que toca `services/uta/`. Cinco archivos existentes
modificados (`UnifiedTradingAccount.ts`, `guards/{cooldown,guard-pipeline,
registry,types}.ts`), todo lo demás nuevo bajo
`services/uta/src/domain/trading/risk/`. Nada en `services/engine/`.

### 9.1 Qué se construyó

- **`risk/policy.ts`**: schema Zod (ADR-0004) + `loadRiskPolicy()`, nunca
  lanza — toda falla (archivo ausente, JSON inválido, schema inválido)
  resuelve a `{ok:false, reason}` para que el llamador falle cerrado
  explícitamente.
- **`risk/risk-state.ts`**: estado persistente, escritura atómica
  (tmp+rename, a diferencia de `git-persistence.ts` — Fase 0 lo marcó como
  no-atómico, y esta vez sí se corrige). `loadRiskState` (tolerante, usada
  por kill-switch/cooldown) vs. `loadRiskStateStrict` (usada por el motor
  principal — ver §9.2 sobre por qué hacían falta las dos).
- **`risk/risk-log.ts`**: `risk-decisions.jsonl`, append-only.
- **`risk/kill-switch.ts`**: `NORMAL | HALT_NEW | FLATTEN`, con `resetKillSwitch`
  rechazando un reset de un halt por pérdida diaria (R16) sin `force`.
- **`risk/rules/r0..r20-*.ts`**: un archivo por regla, funciones puras
  (`(ctx: RiskContext) => RiskRuleRejection | null`), más `shared.ts` con
  helpers de notional/exposición/equity.
- **`risk/risk-engine.ts`**: `evaluateRisk()` — arma el `RiskContext`
  (política, posiciones, cuenta, estado, quote, market clock, y para
  `modifyOrder` el estado actual de la orden vía `broker.getOrders()`),
  corre la cadena R0–R20, actualiza estado (rechazos consecutivos,
  contador de trades, cooldown, HWM, kill switch), registra en el log.
- **`risk/risk-dispatcher.ts`**: el punto de inserción M1 — con
  `OPENALICE_RISK_ENGINE_ENABLED` sin definir, devuelve la MISMA
  referencia de función `dispatcher` sin envolver nada.
- **M1** (`UnifiedTradingAccount.ts`): `riskCheckedDispatcher =
  wrapDispatcherWithRiskEngine(guardedDispatcher, broker, this.id)` — antes
  de los guards existentes, como pide PROMPT_MASTER §5.
- **M2** (`guards/registry.ts`): `OPENALICE_RISK_STRICT=1` → tipo de guard
  desconocido lanza en vez de `console.warn` + skip.
- **M3** (`guards/cooldown.ts`): con el flag de RiskEngine activo, `check()`
  ya no escribe nada (se lo cede a R13, que lee el mismo estado
  persistente) y un nuevo `recordSuccess()` — llamado por
  `guard-pipeline.ts` solo después de que `dispatcher(op)` resuelve sin
  lanzar — escribe el cooldown. Con el flag apagado, sigue exactamente el
  comportamiento original (Map en memoria, se escribe dentro de `check()`).
  `guards/types.ts` y `guard-pipeline.ts` ganaron un hook opcional
  `recordSuccess` — aditivo, ningún guard existente lo implementa.

### 9.2 Un hallazgo real encontrado construyendo esto (no un hallazgo del repo — de mi propio diseño)

Mi primera versión de `loadRiskState` trataba CUALQUIER error de lectura
(archivo ausente **o** archivo corrupto) igual: devolvía un estado inicial
fresco (`killSwitch: 'NORMAL'`). Eso es exactamente lo opuesto de
fail-closed — un archivo de estado corrompido habría *enmascarado* un
`HALT_NEW`/`FLATTEN` existente en vez de bloquear. Lo encontré yo mismo
escribiendo el test de "estado corrupto → HALT_NEW" antes de que nadie más
lo señalara, y lo corregí separando dos funciones: `loadRiskState`
(tolerante — solo la usan `kill-switch.ts`/`cooldown.ts`, donde un archivo
ausente es el caso normal y el llamador está a punto de escribir un valor
nuevo de todos modos) y `loadRiskStateStrict` (la que usa el flujo
principal de `evaluateRisk` — un archivo ausente sigue siendo válido,
"primera vez", pero un archivo presente que no parsea o le faltan campos
requeridos devuelve `{ok:false}` explícito).

### 9.3 Particularidad de Windows encontrada (no del repo — de mi propia implementación)

El primer test de concurrencia sobre `saveRiskState` (10 guardados en
paralelo al mismo archivo) falló primero con `ENOENT` (dos escrituras
concurrentes podían generar el MISMO nombre de archivo temporal —
`pid+Date.now()` no es único bajo `Promise.all`, corregido añadiendo
`randomUUID()`), y luego con `EPERM` incluso con nombres de tmp únicos:
Windows puede rechazar transitoriamente un `rename()` hacia un destino que
otro handle está tocando en ese instante — a diferencia de POSIX, donde
`rename(2)` es atómico y no falla así. `saveRiskState` ahora reintenta
(hasta 5 veces, backoff corto) específicamente sobre `EPERM`/`EBUSY`. En
uso real esto es infrecuente (`evaluateRisk` de una cuenta corre de a una
operación por vez — `TradingGit` ya serializa "un solo commit pendiente
por cuenta"), pero la función es una primitiva de persistencia reusable y
no debía asumirlo.

### 9.4 Resultados reales — flag apagado (línea base, debe ser idéntica a Fase 0)

```
pnpm test:owner:uta
  Test Files  58 passed (58)
       Tests  1055 passed (1055)

pnpm test:integration:uta
  Test Files  1 passed (1)
       Tests  15 passed (15)
```

Coincide exactamente con la línea base de Fase 0 (§3 de este documento).
Con los 5 archivos nuevos de tests del RiskEngine incluidos (que se
configuran su propia política/flag por test, no dependen de estado
ambiental), el total sube a **63 archivos / 1121 tests, todos en verde**,
sin que ningún test preexistente cambie de resultado.

### 9.5 Resultados reales — flag encendido, SIN política configurada

```
OPENALICE_RISK_ENGINE_ENABLED=1 pnpm test:owner:uta
  Test Files  3 failed | 55 passed (58)
       Tests  20 failed | 1035 passed (1055)

OPENALICE_RISK_ENGINE_ENABLED=1 pnpm test:integration:uta
  Test Files  1 failed (1)
       Tests  12 failed | 3 passed (15)
```

**Esto es el comportamiento correcto, no una regresión.** Ningún test
preexistente configura `OPENALICE_RISK_POLICY_PATH`, así que con el flag
encendido el RiskEngine busca la política en
`/etc/openalice/risk-policy.json` (no existe en esta máquina), falla
cerrado, y bloquea toda escritura — exactamente lo que "política ausente
→ HALT_NEW" exige. Los tests que fallan son los que esperaban que una
orden llegara de verdad al broker; los que no tocan `placeOrder`/
`modifyOrder` (o solo leen) siguen pasando. La demostración real de que el
RiskEngine funciona **con** una política es la suite dedicada en
`risk/*.spec.ts`, que sí la configura explícitamente por test.

### 9.6 Los 5 tests de aceptación pedidos, con su resultado real

1. **Flag apagado = idéntico a la línea base** — §9.4 arriba.
2. **Las 4 rutas de escritura pasan por el RiskEngine, 0 llamadas a
   `broker.placeOrder` cuando rechaza todo** —
   `risk-dispatcher-integration.spec.ts`, 4/4 tests verdes:
   - Ruta B (stage→commit→push a nivel de método UTA, la que respalda
     `HTTP wallet/push` del lado servidor) y su variante vía HTTP real
     (`app.request('/uta/:id/wallet/push')`).
   - Ruta C (`HTTP wallet/place-order` one-shot).
   - Rutas A (tool `tradingPush`) y D (push vía Connector) no se invocan
     directamente (viven en `src/`, proceso Alice separado) — se
     establece por lectura de código fresca en esta sesión que ambas
     llaman a `UTAAccountSDK.push()`
     (`src/services/uta-client/UTAAccountSDK.ts:290`), que hace POST al
     MISMO endpoint `/wallet/push` que la ruta B ya prueba — Alice y UTA
     son procesos separados que solo se comunican por HTTP (Fase 0), así
     que no existe otro camino hacia el broker para A y D.
3. **Fail-closed: política ausente, inválida, estado corrupto → HALT_NEW**
   — `risk-engine.spec.ts`, 4/4 casos verdes (incluye JSON inválido, sin
   entrada de cuenta, y estado corrupto además de archivo ausente).
4. **`modifyOrder` que agranda una posición → rechazado** —
   `risk-engine.spec.ts` + `rules.spec.ts` (R18), verde.
5. **Kill switch persiste tras reiniciar UTA** — `risk-engine.spec.ts`
   ("kill switch persists across a simulated restart", llama a
   `evaluateRisk` dos veces sin ninguna referencia compartida en memoria
   entre ambas llamadas, la segunda solo puede saber del halt leyéndolo
   de disco) y `risk-state.spec.ts` (round-trip directo del estado), verde.

### 9.7 Comandos ejecutados

```
cd services/uta && pnpm typecheck   # limpio
cd services/uta && pnpm build       # limpio (dist/uta.js 331.59 KB)
npx tsc --noEmit                    # limpio (raíz)
pnpm test:owner:uta                 # 58/58, 1055/1055 (flag off) · 63/63, 1121/1121 (con los tests nuevos)
pnpm test:integration:uta           # 1/1, 15/15 (flag off)
OPENALICE_RISK_ENGINE_ENABLED=1 pnpm test:owner:uta        # 55/58, 1035/1055 (fail-closed sin política — esperado)
OPENALICE_RISK_ENGINE_ENABLED=1 pnpm test:integration:uta  # ídem
```

### 9.8 Ajuste — evitar fail-open de despliegue (2026-09-26)

**Problema real que esto cierra:** un operador podía configurar
`OPENALICE_RISK_POLICY_PATH` (creyendo que así "activa" la política) sin
darse cuenta de que también hacía falta `OPENALICE_RISK_ENGINE_ENABLED=1`
— UTA arrancaría igual, con una política presente en disco pero
**nunca evaluada**. Parece gobernado; no lo está.

**Arreglo:** `services/uta/src/domain/trading/risk/deployment-safety.ts`,
función pura `checkRiskEngineDeploymentSafety(env)`, llamada al inicio de
`services/uta/src/main.ts` antes de cualquier otra cosa:

- `OPENALICE_RISK_POLICY_PATH` definido + flag apagado → `{ok:false}` →
  `main.ts` hace `console.error` + `process.exit(1)`. UTA no arranca.
- Flag apagado sin política definida (desarrollo local normal) →
  `{ok:true, warn:...}` → UTA arranca, pero con un `console.warn` visible
  diciendo que el RiskEngine está desactivado.
- Flag encendido (con o sin política explícita — cae al path por
  defecto) → `{ok:true}`, sin warning.

**`docs/risk-engine.md`** (nuevo — guía real de owner, no un doc de
auditoría de esta sesión): documenta el flag, el gate de arranque, la
tabla completa de R0–R20, el kill switch, M2/M3, y deja escrito
explícitamente: *"Production (Fase 10) requirement:
`OPENALICE_RISK_ENGINE_ENABLED=1` is mandatory"* — cómo se garantiza eso
operacionalmente (systemd, Compose, o una aserción propia del tooling de
despliegue) queda para cuando se escriba `deploy/RUNBOOK.md` en la Fase
10; esta guía deja registrado el requisito para que no haya que
redescubrirlo entonces. Registrada también en el índice de
`docs/README.md`.

**Tests, salida real** (`deployment-safety.spec.ts`, 6/6 verdes):

```
✓ refuses to start: policy path configured but the engine flag is off
✓ refuses to start even if the flag is set to something other than "1" (e.g. "true")
✓ starts fine, no warning, when both the policy path and the flag are set correctly
✓ starts fine but with a visible warning when the flag is off and no policy path is set (intentional local dev)
✓ starts fine, no warning, when the flag is on even without an explicit policy path (falls back to the default path)
✓ treats a blank/whitespace-only policy path as not set

Test Files  1 passed (1)
     Tests  6 passed (6)
```

### 9.9 Ajuste — fail-closed en la propia escritura del estado (2026-09-26)

**El hueco real, confirmado antes de arreglar nada:** `finalizeAllowed`/
`finalizeRejected`/`finalize` en `risk-engine.ts` llamaban a
`saveRiskState(...)` sin ningún `try/catch` propio. Si esa escritura
fallaba definitivamente (después de agotar los reintentos EPERM/EBUSY de
§9.3), la excepción se propagaba sin capturar hasta el `try/catch` por
operación de `TradingGit.executePush()` — que sí bloqueaba ESA operación
puntual, pero (a) nunca tocaba el kill switch, así que la SIGUIENTE
operación seguía evaluándose con normalidad contra un estado que podría
estar desactualizado, y (b) el error quedaba mezclado con cualquier otro
error genérico de dispatch, sin una etiqueta distinguible.

**Arreglo:** nueva función `persistOrForceHalt()` en `risk-engine.ts`,
usada por las tres funciones `finalize*`. Si `saveRiskState` falla: se
registra el error explícitamente (`console.error` con el prefijo
`[uta:risk]`), se intenta (best-effort — puede fallar también, se traga
esa segunda falla) persistir `HALT_NEW` con motivo
`STATE_WRITE_FAILURE: ...`, y se devuelve un veredicto **forzado**
`{allowed:false, ruleCode:'STATE_WRITE_FAILURE', killSwitch:'HALT_NEW'}`
— sin importar qué había decidido la cadena de reglas (incluso si la
cadena decía ALLOW).

**Test, salida real capturada** (`risk-engine-write-failure.spec.ts`,
aislado en su propio archivo porque usa `vi.mock` sobre `risk-state.js`
para producir un fallo de escritura real y controlado, sin ensuciar los
tests de sistema de archivos reales de `risk-engine.spec.ts`):

```
stderr | ... forces HALT_NEW and reports STATE_WRITE_FAILURE ...
[uta:risk] risk state write failed definitively: simulated definitive disk failure (as if all EPERM/EBUSY retries were exhausted) — forcing HALT_NEW for account "risk-engine-write-failure-target" (not continuing on in-memory state)

✓ forces HALT_NEW and reports STATE_WRITE_FAILURE instead of returning the rule chain's real (allow) verdict
✓ also forces HALT_NEW when the write fails on a rule REJECTION path (not just the allow path)
✓ an unrelated account (not sabotaged) is unaffected — the mock passes through to the real implementation

Test Files  1 passed (1)
     Tests  3 passed (3)
```

### 9.10 Resultado final tras los tres ajustes

```
cd services/uta && pnpm typecheck    # limpio
cd services/uta && pnpm build        # limpio (dist/uta.js 333.97 KB)
pnpm test:owner:uta                  # 65/65, 1130/1130 (flag off — 63/1121 + 9 tests nuevos)
pnpm test:integration:uta            # 1/1, 15/15 (sin cambios)
```

---

## 10. Fase 4b — UTA Auth (`feat/engine-f4b-uta-auth`) — 2026-09-26

M7 (tokens con scopes en el servidor) y M8 (`Authorization: Bearer` en
cada cliente) implementados tal como ADR-0003 los diseñó, con una
desviación deliberada (recarga sin caché en vez de recarga por SIGHUP —
ver la sección "Implementación" añadida a `docs/adr/0003-uta-token-auth.md`).
Detalle operativo completo en [[docs/uta-auth.md]] (nueva guía, registrada
en `docs/README.md`).

### 10.1 Qué se construyó

- `services/uta/src/domain/trading/auth/types.ts` — scopes fijos
  (`read`, `stage`, `approve`, `engine`, `operator`, `simulator`) y el
  esquema Zod del archivo de tokens.
- `services/uta/src/domain/trading/auth/tokens-file.ts` — `loadUtaTokens()`
  (nunca lanza, igual que `loadRiskPolicy`) y `findToken()` (comparación
  en tiempo constante vía `timingSafeEqual`, mismo cuidado que
  `src/services/auth/token-store.ts`).
- `services/uta/src/domain/trading/auth/deployment-safety.ts` —
  `checkUtaAuthDeploymentSafety()`: bind no-loopback sin archivo de
  tokens → rechaza arrancar; loopback sin archivo → arranca en modo
  compatibilidad con warning explícito en cada arranque.
- `services/uta/src/http/auth.ts` — `utaAuthMiddleware()` +
  `requiredScope()`: tabla ruta→scope centralizada (ningún route handler
  de `routes-trading.ts`/`routes-simulator.ts` se tocó). Sin token → 401.
  Token válido sin el scope requerido → 403. Fallback conservador:
  cualquier ruta no mapeada explícitamente exige `operator`.
- `services/uta/src/main.ts` — gate de deployment-safety al arranque
  (junto al de RiskEngine), `OPENALICE_UTA_BIND_HOST` reemplaza el
  `127.0.0.1` fijo, middleware montado en `/api/trading/*` y
  `/api/simulator/*` (no en `/__uta/health`, que sigue público).
- Cliente (M8): `packages/uta-protocol/src/client/UTAClient.ts`
  (`token` opcional → header `Authorization`), `src/main.ts` de Alice
  (lee `OPENALICE_UTA_TOKEN`), `src/webui/routes/trading-proxy.ts` +
  `src/webui/plugin.ts` (el proxy BFF adjunta el mismo token de Alice,
  **nunca** reenvía el `Authorization` que trajo el navegador — ese es un
  boundary completamente distinto, la cookie de sesión de
  `src/webui/middleware/auth.ts`), `services/engine/src/uta/uta-client.ts`
  (`token` opcional, listo para cuando el runtime del Engine exista).

### 10.2 Resultados reales

```
cd services/uta && pnpm typecheck                        # limpio
cd packages/ibkr && pnpm build                            # limpio (dependencia de uta-protocol; no construible standalone sin esto — condición preexistente, no de esta fase)
cd packages/uta-protocol && pnpm build                     # limpio
cd services/uta && pnpm build                              # limpio (dist/uta.js 339.51 KB, antes 333.97 KB)
npx tsc --noEmit (raíz, cubre src/)                        # limpio
corepack pnpm exec tsup src/main.ts --format esm --dts     # limpio (warning preexistente y no relacionado: direct-eval en calculate.tool.ts)
cd services/engine && pnpm typecheck                       # limpio (warning informativo: node actual v24.12.0 < engines.node >=24.15.0 declarado — ver ADR-0002, pendiente de confirmación del usuario)
cd services/engine && pnpm test                            # 19/19 archivos, 83/83 tests
pnpm test:owner:uta                                        # 69/69 archivos, 1178/1178 tests (flag off — línea base + tests nuevos de auth)
pnpm test:integration:uta                                  # 1/1, 15/15 (sin cambios)
npx vitest run src/webui/routes/trading-proxy.spec.ts       # 1/1, 14/14 (12 preexistentes + 2 nuevos)
node scripts/run-tests.mjs --package @traderalice/uta-protocol  # 2/2, 4/4
```

`npx vitest run src/webui` corre 34 archivos; 3 fallan (`workspace-content`
symlink test y dos aserciones de ruta con separador Windows en
`workspaces.spec.ts`) — **preexistentes, sin relación** con `trading-proxy.ts`
ni con esta fase (ningún archivo tocado en Fase 4b aparece en esos tests).

### 10.3 Hallazgo preexistente confirmado (no de esta fase)

`packages/uta-protocol` y `packages/ibkr` no se pueden `tsc --noEmit` /
`pnpm build` de forma standalone dentro de su propio directorio — ambos
fallan con `Cannot find module '@traderalice/ibkr'` hasta que
`packages/ibkr` se construye primero (o se corre vía el orquestador
`turbo`/`scripts/run-tests.mjs`, que sí resuelve el workspace
correctamente). Confirmado que preexiste (mismo error con
`git stash` aplicado, antes de cualquier cambio de esta fase). `npx turbo
run build` también falló en este entorno concreto (`Unable to find
package manager binary`) — build hecho paquete-por-paquete en su lugar
para verificar; no se investigó más a fondo por no ser parte del alcance
de esta fase.

**Nota para los Dockerfiles de la Fase 10:** esto no es un bug a
arreglar en Fase 4b — es la topología normal de un monorepo con
project references (`packages/ibkr` → `packages/uta-protocol` →
`services/uta`/`services/engine`). El Dockerfile de cada servicio debe
invocar el build a través de `turbo run build --filter=<paquete>...`
(el `...` de Turborepo incluye las dependencias del paquete, ya
declaradas en cada `package.json` — `^build` en la definición de la
tarea en `turbo.json` es lo que ya fuerza ese orden) en vez de llamar a
`tsc`/`tsup` directamente dentro del directorio de un solo paquete. La
falla de `npx turbo run build` en este entorno concreto (`Unable to find
package manager binary`) es una particularidad de este checkout/entorno
Windows — no se investigó a fondo por no ser parte del alcance de esta
fase, pero Fase 10 debe confirmar que el orquestador real (`turbo` vía
`corepack pnpm exec turbo`, o el CI del proyecto) sí resuelve el
workspace correctamente antes de asumir que el Dockerfile funcionará.

---

## 11. Fase 4b aprobada CON CORRECCIONES — Parte A (2026-09-27)

### 11.1 A.1 — Tokens fail-closed, decidido una sola vez al arrancar

`services/uta/src/http/auth.ts`: `utaAuthMiddleware()` ahora recibe el
path resuelto de `OPENALICE_UTA_TOKENS_FILE` como argumento fijo
(resuelto una única vez en `main.ts` al arrancar), en vez de releer la
variable de entorno en cada request. El archivo en sí se sigue
releyendo en cada request (mismo precedente que `risk/policy.ts`, sin
caché), pero el propio *modo* (compatibilidad vs. forzado) queda fijado
para toda la vida del proceso. Cualquier fallo de lectura posterior
(archivo borrado, vacío, JSON corrupto, escritura a medias) ahora
deniega TODO (401/403 según corresponda, 503 si el archivo no carga) y
registra una alerta (`console.error`), sin jamás caer de vuelta al modo
compatibilidad. Añadido `checkTokensFileDevLocation()`
(`domain/trading/auth/deployment-safety.ts`): warning explícito al
arrancar si el archivo de tokens configurado vive dentro de
`OPENALICE_HOME` (peor aún, dentro de un Workspace). Documentado en
`docs/uta-auth.md` que en producción el archivo va montado en solo
lectura (Docker secret o bind `:ro`).

Salida real (`services/uta/src/http/auth.spec.ts`, suite nueva
"Fase 4b corrección A.1: never falls back to compatibility mode"):

```
✓ a valid token works, then deleting the file mid-run denies everything (401/503), never a silent pass-through
✓ a corrupted file (truncated JSON) denies everything, then restoring valid content recovers
✓ an empty file (zero bytes) denies everything — not valid JSON, not "no auth configured"
```

### 11.2 A.2 — Default-deny, auditoría exhaustiva de rutas

Nuevo `services/uta/src/http/route-scope-audit.spec.ts`: enumera las
rutas reales que registran `createTradingRoutes()` (39) y
`createSimulatorRoutes()` (9) vía `app.routes` de Hono (no una lista
copiada a mano), las compara contra una tabla de expectativas explícita
y falla si aparece una ruta sin decisión de scope deliberada, o si
alguna ruta de escritura (verbo≠GET/HEAD) resuelve a `read` fuera de la
lista blanca documentada (las 7 lecturas de mercado/cuenta que viajan
con cuerpo JSON: `quote`, `historical`, `contracts/details`,
`contract/option-contracts`, `contract/option-chain`,
`contract/order-book`, `contract/expand`).

Salida real:

```
Test Files  70 passed (70)
     Tests  1229 passed (1229)
```

(línea base previa a A.1/A.2: 69 archivos, 1178 tests — el delta son
las suites nuevas `route-scope-audit.spec.ts` y las tres pruebas de
"never falls back" de A.1, más las de `checkTokensFileDevLocation`).

`pnpm test:integration:uta` — sin cambios: 1/1, 15/15.
`cd services/uta && pnpm build` — limpio, `dist/uta.js` 341.04 KB.

### 11.3 A.3 — Confirmación real de los 3 ajustes de la Fase 4a

Salida real, re-ejecutada hoy, de los tres puntos que la aprobación
pidió confirmar explícitamente (no solo "está documentado" — la salida
de abajo es de una ejecución fresca de esta sesión):

**Trampas de lookahead realistas + test del constructor de contexto**
(`services/engine/src/strategies/context-builder.spec.ts` +
`services/engine/test/property/lookahead-trap.spec.ts`, 14/14):

```
✓ buildStrategyContext — THE real no-lookahead guarantee > never includes bars timestamped after asOf, even when the raw dataset contains them
✓ buildStrategyContext — THE real no-lookahead guarantee > excludes the trailing bar specifically when it has not closed by asOf, independent of future bars
✓ buildStrategyContext — THE real no-lookahead guarantee > includes every closed bar up to and including one that closes exactly at asOf
✓ Trap (a) — a real strategy fed leaked future bars decides differently than through the builder > momentum sees a future price spike if the caller bypasses buildStrategyContext, but never if it goes through it
✓ Trap (b) — a real strategy fed an unclosed "open candle" as if it were final > momentum reacts to a still-forming candle when bypassing the builder, never when going through it
✓ Trap (c) — a feature computed using bar t+1 > the buggy feature is undefined/NaN under proper truncation but "works" when future data leaks in — proving it depends on t+1
✓ Trap (c) — a feature computed using bar t+1 > the correct feature is identical whether or not future data is present (real no-lookahead)
✓ no-lookahead mutation test > the trap strategy DOES see the future (sanity check on the trap itself)
✓ no-lookahead mutation test > assertNoLookahead FAILS (throws) against the trap strategy
✓ no-lookahead mutation test > assertNoLookahead PASSES for strategy trend-following/mean-reversion/breakout/momentum (the same assertion the trap fails)
✓ no-lookahead mutation test > assertNoLookahead PASSES for regime-switch (E) on an oscillating fixture

Test Files  2 passed (2)
     Tests  14 passed (14)
```

**Negativa a arrancar con política definida y flag apagado**
(`services/uta/src/domain/trading/risk/deployment-safety.spec.ts`):

```
✓ checkRiskEngineDeploymentSafety > refuses to start: policy path configured but the engine flag is off
✓ checkRiskEngineDeploymentSafety > refuses to start even if the flag is set to something other than "1" (e.g. "true")
✓ checkRiskEngineDeploymentSafety > starts fine, no warning, when both the policy path and the flag are set correctly
✓ checkRiskEngineDeploymentSafety > starts fine but with a visible warning when the flag is off and no policy path is set (intentional local dev)
```

**HALT_NEW si falla definitivamente la escritura del estado**
(`services/uta/src/domain/trading/risk/risk-engine-write-failure.spec.ts`,
con la línea real de `console.error` capturada, no resumida):

```
stderr | ... forces HALT_NEW and reports STATE_WRITE_FAILURE instead of returning the rule chain's real (allow) verdict
[uta:risk] risk state write failed definitively: simulated definitive disk failure (as if all EPERM/EBUSY retries were exhausted) — forcing HALT_NEW for account "risk-engine-write-failure-target" (not continuing on in-memory state)

✓ forces HALT_NEW and reports STATE_WRITE_FAILURE instead of returning the rule chain's real (allow) verdict
✓ also forces HALT_NEW when the write fails on a rule REJECTION path (not just the allow path)
✓ an unrelated account (not sabotaged) is unaffected — the mock passes through to the real implementation
```

Los tres puntos: **confirmados con salida real, sin regresiones.**

---

## 12. Segunda ronda de revisión sobre la 4b — items 1, 2, 4 (2026-09-27)

Nota de proceso: los items 1, 2 y 4 de esta ronda se implementaron por
error inicialmente sobre `docs/phil-improvements` en vez de
`feat/engine-f4b-uta-auth` — detectado antes de commitear, movido con
`git stash` a la rama correcta, `docs/phil-improvements` rebaseada
encima sin conflictos. Documentado aquí para que quede trazable.

### 12.1 Item 1 — salida real de los tests de A.1 (borrado/corrupción en caliente)

Ya existían (creados en la ronda de correcciones anterior); se
re-ejecutaron con `--reporter=verbose` para esta parada, salida real:

```
stderr | ... fails closed (503) when the tokens path was configured at boot but the file does not exist
[uta:auth] tokens file unreadable/invalid — denying ALL requests, not falling back to compatibility mode: cannot read UTA tokens file at ...\definitely-does-not-exist-uta-tokens.json: ENOENT: no such file or directory, open '...'

stderr | ... an empty file (zero bytes) denies everything — not valid JSON, not "no auth configured"
[uta:auth] tokens file unreadable/invalid — denying ALL requests, not falling back to compatibility mode: UTA tokens file at ...\uta-tokens.json is not valid JSON: Unexpected end of JSON input

✓ a valid token works, then deleting the file mid-run denies everything (401/503), never a silent pass-through
✓ a corrupted file (truncated JSON) denies everything, then restoring valid content recovers
✓ an empty file (zero bytes) denies everything — not valid JSON, not "no auth configured"
```

### 12.2 Item 2 — corrección de scope: `/uta/:id/sync`

Confirmado, con salida real, que las otras 3 rutas señaladas ya
resolvían correctamente (`operator`) y solo `/sync` necesitaba bajar a
`stage` (escribe un commit real de sincronización de fills/cancelaciones,
`UnifiedTradingAccount.sync() -> this.git.sync()`, no es una acción
administrativa):

```
✓ POST /test-connection -> operator (matches requiredScope)
✓ POST /uta/:id/reconnect -> operator (matches requiredScope)
✓ POST /uta/:id/sync -> stage (matches requiredScope)         [corregido — antes: operator]
✓ POST /uta/:id/simulate-price -> operator (matches requiredScope)
✓ DELETE /uta/:id/snapshots/:timestamp -> operator (matches requiredScope)
```

`docs/uta-auth.md` documenta ahora, explícitamente y una por una, las 7
rutas de escritura que sí resuelven a `read` (con su justificación) y
las 4 que no pueden serlo (con su scope correcto).

### 12.3 Item 4 — correlación commit↔decisión (requisito de A5, implementado ahora)

Hallazgo real durante la implementación que corrige el diseño original
de ADR-0010: el hash del commit y la posición de la operación ya se
conocen en `TradingGit.executePush()` **antes** de invocar
`executeOperation` (el hash se computa en `commit()`, antes de
`push()`) — no había que inventar un campo en otro punto, solo
pasarlo. `TradingGitConfig.executeOperation` ahora recibe
`{commitHash, operationIndex}`; `risk-decisions.jsonl` gana
`pendingHash`, `operationIndex`, y `orderId` (solo para
modifyOrder/cancelOrder — verificado que `Order.orderId` es `0` hasta
que el broker lo asigna, así que se omite para placeOrder en vez de
loguear un `0` sin sentido).

Salida real, nuevo `risk-decision-correlation.spec.ts` (verifica contra
el flujo real `stage -> commit -> push`, no solo el valor de retorno de
`toLogEntry` en aislado):

```
✓ a single placeOrder logs pendingHash === the real push commit hash, operationIndex 0, and no orderId (none exists yet)
✓ two operations staged into ONE commit share the same pendingHash but get distinct operationIndex values
✓ a modifyOrder logs the real orderId (a genuine pre-existing correlation field, unlike placeOrder)
✓ a rejected operation (never reaches the broker) still logs a correlation to the commit that recorded the rejection
```

### 12.4 Resultado tras items 1, 2, 4

```
cd services/uta && pnpm typecheck    # limpio
pnpm test:owner:uta                  # 71/71 archivos, 1233/1233 tests
pnpm test:integration:uta            # 1/1, 15/15
cd services/uta && pnpm build        # limpio (dist/uta.js 342.22 KB)
```

---

## 13. Fase 4c — Auditoría independiente + R21 (`feat/engine-f4c-audit-spread`) — 2026-09-27

Alcance exacto pedido: **solo A5 y A7a**, todo detrás de
`OPENALICE_RISK_ENGINE_ENABLED`, fail-closed.

### 13.1 R21 — max spread (A7a)

`services/uta/src/domain/trading/risk/rules/r21-max-spread.ts` — nueva
regla, registrada en `RULE_CHAIN` tras R20. Antes de escribirla se
verificó qué da cada broker pack real (`bid:`/`ask:` en cada
`*Broker.ts`): Alpaca/CCXT/IBKR/Longbridge/MockBroker dan bid/ask real
(CCXT/IBKR caen a `'0'` cuando el ticker no lo tiene — el sentinel que
R21 detecta); **Leverup no** — pone `bid: last, ask: last` con el
comentario explícito "Pyth gives mid; no bid/ask split", así que
`spreadBps` da siempre `0` para Leverup. Documentado como limitación
conocida en `docs/risk-engine.md` y en `BACKLOG.md`, no oculto —
detectar genéricamente "bid === ask" como señal de "no disponible" se
consideró y se descartó (falso positivo en un mercado real
momentáneamente ajustado en cualquier otro broker).

`deploy/examples/risk-policy.example.json` creado (pendiente desde
ADR-0004, Fase 1) con `maxSpreadBps: 50` incluido; nuevo test en
`policy.spec.ts` que lo carga vía `loadRiskPolicy()` real.

Salida real (`rules.spec.ts`, suite `R21 max spread`):

```
✓ is a no-op when maxSpreadBps is not configured
✓ fails closed with no quote at all
✓ rejects when bid/ask is unavailable (broker reports the 0 sentinel — CCXT/IBKR when the ticker has none)
✓ rejects a negative bid (defensive — should never happen, but never silently divide by it)
✓ blocks when the spread exceeds the configured limit
✓ allows a spread at or under the configured limit
✓ applies to modifyOrder too, not just placeOrder
```

### 13.2 A5 — auditoría independiente

`services/uta/src/domain/trading/risk/audit/` — `audit-job.ts` (puro:
`auditAccount()`), `audit-log.ts` (`data/trading/<id>/_risk/audit.jsonl`,
solo se escribe si hay discrepancia), `audit-runner.ts`
(`runAuditAndEnforce()`: no-op con el flag apagado, si no hay hallazgos
no hace nada, si los hay fuerza `HALT_NEW` + `console.error` + persiste).
Corre al arrancar UTA y cada 24h (`main.ts`).

Tres tipos de hallazgo: `MISSING_DECISION` (operación ejecutada sin
PASS correspondiente — el caso pedido explícitamente), `RISK_BYPASSED`
(una decisión rechazada cuya operación igual tuvo éxito — más grave
aún), `PASS_DURING_HALT` (una decisión permitida mientras el kill
switch ya estaba activo). Un desajuste de `policyHash` es solo una nota
informativa, nunca un hallazgo duro — este repo no conserva historial
de versiones pasadas de la política, así que un cambio normal de
política con el tiempo no es distinguible de una manipulación sin ese
historial; tratar cada desajuste como discrepancia haría fallar la
auditoría con cualquier actualización rutinaria del operador, no solo
con problemas reales.

Salida real (`audit-job.spec.ts`, lógica pura con fixtures sintéticos):

```
✓ a clean ledger (every executed operation has its matching PASS) passes with no findings
✓ an operation executed with no matching decision at all -> MISSING_DECISION
✓ a decision recorded as rejected, but the operation succeeded anyway -> RISK_BYPASSED
✓ an allowed decision recorded while the kill switch was already HALT_NEW -> PASS_DURING_HALT
✓ closePosition/cancelOrder operations are skipped entirely — the RiskEngine never evaluates them
✓ a policyHash mismatch is an informational note, not a hard finding (policy changes over time are normal)
```

Salida real (`audit-runner.spec.ts`, **contra un push real**, no un
fixture sintético — exactamente el criterio de aceptación pedido: "una
operación ejecutada sin PASS"):

```
✓ no-ops entirely when the RiskEngine flag is off — nothing to audit
✓ a clean ledger (real push, decision log intact) passes with no HALT_NEW and no audit.jsonl
✓ an operation executed with no matching PASS (log entry lost after the fact) fails the audit, forces HALT_NEW, logs an alert, and persists the finding
```

El tercer test: hace un `stage -> commit -> push` real con
`OPENALICE_RISK_ENGINE_ENABLED=1`, borra `risk-decisions.jsonl`
después (simulando la pérdida real que la auditoría existe para
detectar — no un caso sintético), corre `runAuditAndEnforce`, y
confirma: `result.ok === false`, `killSwitch` pasa a `HALT_NEW` (leído
de vuelta con `getKillSwitchStatus`, no solo el valor de retorno),
`console.error` se llamó con el mensaje real, y `audit.jsonl` contiene
`MISSING_DECISION` en disco.

### 13.3 Resultado final

```
cd services/uta && pnpm typecheck                          # limpio
pnpm test:owner:uta                                         # 73/73 archivos, 1250/1250 tests (flag off — línea base + tests nuevos de R21/auditoría)
pnpm test:integration:uta                                   # 1/1, 15/15 (sin cambios)
cd services/uta && pnpm build                               # limpio (dist/uta.js 347.92 KB)
OPENALICE_RISK_ENGINE_ENABLED=1 node scripts/run-tests.mjs --package @traderalice/uta-service
  # 20 fallos — MISMO comportamiento ya documentado en Fase 4a (docs/risk-engine.md,
  # "flag on, no policy configured: fails closed everywhere that writes — expected,
  # not a regression"); no relacionado con R21/auditoría, no investigado más a fondo
  # por ser un resultado ya conocido de antes de esta fase.
```

### 13.4 Pendiente — `MEJORAS_DESDE_PHIL.md`

El usuario indicó haberlo guardado en `C:\AliceTrader\MEJORAS_DESDE_PHIL.md`;
verificado dos veces en esta sesión (`Test-Path`, `Get-ChildItem`) y
**no está en esa ruta ni en ningún lugar accesible de `C:\AliceTrader\`**.
No se copió a `docs/trading-engine/` ni se quitó la nota
correspondiente en `BACKLOG.md` — pendiente de que el usuario confirme
la ruta real o lo vuelva a adjuntar.

---

## 14. Hito 1 (parte 1) — SIGNAL_ONLY con datos reales (`feat/engine-hito1-signal-only`) — 2026-09-27

Alcance de esta parada (items 1–4 del Hito 1; items 5–7 y la aceptación
de 24h **no** empiezan hasta aprobar esto): scheduler alineado a velas,
journal SQLite con migraciones, configuración real con aliceIds
verificados contra Bybit en vivo, y 3 ciclos SIGNAL_ONLY reales.

**Aclaración pedida y respondida antes de empezar:** para "3 ciclos
reales" el usuario confirmó (pregunta explícita, respuesta elegida:
"Datos reales, sin esperar 3h") que no hace falta bloquear 3 horas de
reloj real — el scheduler queda correcto y probado con reloj inyectable,
y la evidencia de los 3 ciclos se genera procesando las últimas 3 velas
de 1h ya cerradas con datos 100% reales de Bybit.

### 14.1 Verificación de red y de entorno antes de construir nada

- `curl https://api.bybit.com/v5/market/time` y `.../instruments-info` —
  conectividad real confirmada desde este entorno antes de asumir que
  el resto del Hito era viable.
- `node -e "require('node:sqlite')..."` — funciona en el Node instalado
  (v24.12.0), con el warning esperado `ExperimentalWarning: SQLite is
  an experimental feature`. ADR-0002 pedía `>=24.15.0` para la
  estabilidad "1.2 Release candidate" en producción; para un demo local
  como este Hito, la versión instalada es suficiente — la brecha con
  la recomendación de ADR-0002 sigue pendiente para Fase 10, no de este
  Hito.

### 14.2 Levantar UTA en vivo — dos hallazgos reales de entorno

Para obtener aliceIds reales (no inventados) hubo que levantar UTA de
verdad, fuera de `pnpm dev`/Guardian (que no está disponible en este
flujo de trabajo). Dos problemas reales encontrados y resueltos, no
ocultados:

1. `node dist/uta.js` y `tsx src/main.ts` fallan con
   `ERR_MODULE_NOT_FOUND` sobre `@traderalice/guardian-runtime/dist/index.js`
   — ese paquete no estaba construido. `packages/ibkr` y
   `@traderalice/uta-protocol` ya tenían este mismo problema documentado
   en la Fase 4b (AUDIT.md §10.3); `guardian-runtime` es un caso más del
   mismo hallazgo (dependencias de workspace no construidas). Resuelto
   construyéndolo (`cd packages/guardian-runtime && pnpm build`).
2. Con `tsx` + `--conditions=openalice-source` (la condición real que
   `scripts/guardian/dev.ts:265` usa), el broker CCXT seguía sin cargar:
   `workspacePacksAllowed()` (`registry.ts:131-136`) exige
   `OPENALICE_LAUNCHER === 'dev'`, que Guardian fija automáticamente y
   que no existe fuera de él. Con `OPENALICE_LAUNCHER=dev` puesto a
   mano, `loadWorkspacePack()` (`registry.ts:109-116`) todavía resolvía
   mal la ruta porque `pnpm --filter ... exec` cambia el cwd del proceso
   hijo al paquete filtrado (`services/uta`), y `appResourcesHome`
   (`@/core/paths.ts`) cae a `process.cwd()` cuando `OPENALICE_APP_HOME`
   no está seteado — resultando en una ruta `services/uta/packages/...`
   en vez de `packages/...` desde la raíz. Resuelto fijando
   `OPENALICE_APP_HOME` explícitamente a la raíz del repo. Con los tres
   env vars (`OPENALICE_LAUNCHER=dev`, `OPENALICE_APP_HOME=<raíz>`,
   `NODE_OPTIONS=--conditions=openalice-source`) UTA arrancó limpio,
   `bybit-readonly` conectado con 1447 mercados reales.

Ninguno de los dos es un bug de este Hito — son gaps reales del camino
"correr UTA fuera de Guardian", que hasta ahora nadie había necesitado
documentar porque todo el trabajo previo de esta sesión usaba
`vitest`/tests (que sí resuelven el workspace correctamente vía
`scripts/run-tests.mjs`), nunca un proceso UTA vivo standalone.

### 14.3 AliceIds reales — verificados por búsqueda de contratos, no inventados

`GET /api/trading/contracts/search?pattern=BTC&source=bybit-readonly&assetClass=crypto`
(y lo mismo para ETH) contra el UTA real, en vivo:

```
bybit-readonly|BTC/USDT:USDT   — "BTC/USDT swap (USDT settled)", CRYPTO_PERP
bybit-readonly|ETH/USDT:USDT   — "ETH/USDT swap (USDT settled)", CRYPTO_PERP
```

Elegidos entre los resultados reales (18 para BTC, 23 para ETH,
incluyendo spot/futuros con vencimiento/otros pares) por ser el
perpetuo USDT — el instrumento más líquido y el uso estándar para una
estrategia de trend-following cripto. Confirmado que
`POST /api/trading/uta/bybit-readonly/historical` devuelve velas 1h
reales para ambos (BTC ~$84,850, ETH ~$2,685 al momento de esta
verificación — precios de mercado real, no simulados).

### 14.4 Componentes construidos

- `services/engine/src/clock/` — `Clock` inyectable, aritmética de
  límites de vela (`candle-boundaries.ts`), y el scheduler
  (`scheduler.ts`): sin reentrada **por construcción** (el siguiente
  timer solo se programa dentro del `.finally()` del ciclo anterior —
  no por un guard sobre un estado `running`, que hubiera sido código
  muerto dado cómo se programa el siguiente tick; ver el propio
  docstring del archivo). `onSkippedOverlap` reporta los límites
  realmente saltados cuando un ciclo lento cruza más de una vela real.
- `services/engine/src/db/` — `node:sqlite`, migraciones numeradas e
  idempotentes con rollback en transacción. Migración 0001: `cycles`,
  `decisions`, `order_intents`, `order_events` (las últimas dos con
  esquema completo desde ya, aunque nada escribe en ellas hasta el modo
  PAPER — ítem 5, no de esta parada).
- `services/engine/src/journal/journal.ts` — capa tipada sobre las
  tablas; toda decisión (incluidas `NONE` con `reasonCodes`) se
  persiste antes de que la función retorne.
- `services/engine/src/config/engine-config.ts` +
  `engine-config.example.json` — Zod schema real, config real con los
  aliceIds verificados en 14.3, estrategia `trend-following`, intervalo
  `1h`.
- `services/engine/src/loop/run-cycle.ts` — la única función que tanto
  el scheduler real como el replay de evidencia llaman: fetch (vía
  `MarketDataStore`, ya existente de Fase 2) → `buildStrategyContext`
  (no-lookahead, ya existente de la corrección de Fase 3) → `strategy.evaluate()`
  → journal. Mismo camino de código, no una versión de juguete para la demo.
- `services/engine/src/cli/signal-only-replay.ts` — el driver que
  genera la evidencia de este gate, reutilizando `runCycle()` sin
  ninguna lógica de decisión propia.

### 14.5 Salida real — tests

```
cd services/engine && pnpm typecheck    # limpio
cd services/engine && pnpm test         # 25/25 archivos, 111/111 tests (antes de este Hito: 19/83)
cd services/engine && pnpm build        # limpio (dist/engine.cjs 105.09 KB — sin cambios, src/main.ts todavía no integra el loop)
```

Incluye una prueba que atrapó un error real de mi propio test (no del
código): asumí que `Bar.timestamp` era el cierre de la vela; es la
**apertura** — una vela 1h abierta a las 14:00 cierra a las 15:00, no a
las 14:00. El test `run-cycle.spec.ts`'s "never includes a bar after
closeAt" tenía la aserción equivocada hasta corregirla; `buildStrategyContext`
(código de producción) ya se comportaba bien desde el principio.

### 14.6 Salida real — 3 ciclos SIGNAL_ONLY contra datos reales de Bybit

```
$ corepack pnpm exec tsx src/cli/signal-only-replay.ts

[replay] config=.../engine-config.example.json
[replay] db=.../services/engine/data/signal-only-replay.db
[replay] uta=http://127.0.0.1:47333
[replay] strategy=trend-following@0.1.0 interval=1h universe=BTC/USDT perp (Bybit), ETH/USDT perp (Bybit)
[replay] real closed boundaries to evaluate: 2026-09-27T15:00:00.000Z, 2026-09-27T16:00:00.000Z, 2026-09-27T17:00:00.000Z

=== cycle_id=1 closeAt=2026-09-27T15:00:00.000Z ===
  BTC/USDT perp (Bybit)  bars=119  NONE reasons=(none)
  ETH/USDT perp (Bybit)  bars=119  NONE reasons=(none)

=== cycle_id=2 closeAt=2026-09-27T16:00:00.000Z ===
  BTC/USDT perp (Bybit)  bars=119  NONE reasons=(none)
  ETH/USDT perp (Bybit)  bars=119  NONE reasons=(none)

=== cycle_id=3 closeAt=2026-09-27T17:00:00.000Z ===
  BTC/USDT perp (Bybit)  bars=119  NONE reasons=(none)
  ETH/USDT perp (Bybit)  bars=119  NONE reasons=(none)

[replay] done — 3 real cycles recorded in .../services/engine/data/signal-only-replay.db
```

Las 6 decisiones son `NONE` — el cruce SMA rápida/lenta de
trend-following genuinamente no se disparó en esta ventana real de
mercado. No se fabricó un `ENTER` para que la demo se viera "más
interesante" — este es el resultado real.

Verificado además leyendo la base SQLite directamente (no solo la
salida de consola), consultando el archivo `.db` real con
`node:sqlite`:

```
cycles:    3 filas, las tres status='completed', candle_close_at = 15:00/16:00/17:00 UTC
decisions: 6 filas (2 símbolos × 3 ciclos), todas kind='NONE'
```

### 14.7 Pendiente antes de la aceptación completa del Hito 1

Esta parada cubre items 1–4 únicamente, como se pidió. **No hecho
todavía** (items 5–7 y la aceptación de 24h del Hito 1): PriceFeeder +
ExecutionManager en modo PAPER contra `engine-paper`, la página de
estado de solo lectura en 47340, `docs/trading-engine/DEMO-LOCAL.md`, y
las 24 horas seguidas sin intervención. El archivo de base de datos de
esta evidencia (`services/engine/data/signal-only-replay.db`) es un
artefacto de demo, no versionado (`.gitignore` actualizado con
`services/engine/data/`) — item 7 más adelante decidirá la ruta real
bajo `OPENALICE_HOME` para el journal de producción, consistente con
el resto de la app (`dataPath()`), en vez del path local usado aquí
solo para esta evidencia.

UTA quedó corriendo en segundo plano durante esta verificación
(`tsx src/main.ts` con los env vars de 14.2) — se detiene al terminar
esta parada; el comando exacto para volver a levantarlo (para cuando
continúe el Hito 1) queda pendiente de documentar en
`docs/trading-engine/DEMO-LOCAL.md` (item 7).

---

## 15. Fase 4c aprobada con ajuste — R21 con cotizaciones sintéticas (2026-09-27)

Corregido `rules/r21-max-spread.ts`: ausente, `bid === ask`, o
`bid > ask` → "sin datos" → rechazo por defecto; `policy.allowSyntheticQuotes`
(default `false`) anula los tres casos por cuenta, sin fabricar un
número de spread desde una cotización cruzada o degenerada. Tabla de
brokers real vs. sintético registrada en `docs/risk-engine.md` y
`docs/trading-engine/BACKLOG.md`.

Salida real (`rules.spec.ts`, nuevos casos):

```
✓ rejects bid === ask by default (Leverup-style synthetic quote — bid=ask=last)
✓ rejects a crossed quote (bid > ask) by default
✓ allowSyntheticQuotes:true accepts a Leverup-style bid===ask quote instead of rejecting
✓ allowSyntheticQuotes:true also accepts a crossed quote (no meaningful spread is computed, the rule just does not apply)
✓ allowSyntheticQuotes:true also accepts a non-positive (absent) quote
✓ allowSyntheticQuotes:true does NOT weaken a real, wide spread — that still rejects normally
```

`node scripts/run-tests.mjs --package @traderalice/uta-service` → 55/55
archivos, 1150/1150 tests. `pnpm test:owner:uta` → 73/73, 1256/1256.
`services/uta && pnpm build` → limpio (348.48 KB).

---

## 16. Respaldo en el fork (A11) + Parte D (4d) — 2026-09-27

### 16.1 Item 2 — `MEJORAS_DESDE_PHIL.md` — sigue sin aparecer

Verificado por tercera vez esta sesión (`Test-Path`,
`Get-ChildItem -Recurse` en `C:\AliceTrader\`, y además en
`C:\Users\Jose\Downloads`/`Desktop`): **no existe en ningún lugar
accesible**, a pesar de que el usuario indicó haberlo movido ahí. No
copiado, nota de "no encontrado" NO retirada de `BACKLOG.md` —
pendiente de confirmación real de la ruta.

### 16.2 Item 3 — respaldo en el fork (A11) — bloqueado en Docker

Sin `gitleaks` instalado; Docker Desktop no respondía
(`failed to connect to the docker API at npipe:...`) al intentar
`docker pull zricethezav/gitleaks`. Pregunté al usuario cómo prefería
proceder (no descargué un binario de terceros sin su decisión
explícita, no inventé un escáner "equivalente" sin que él eligiera esa
opción) — eligió iniciar Docker Desktop él mismo. **A la hora de este
commit, Docker sigue sin responder** (`docker info` → mismo error) —
el escaneo de gitleaks y el push al fork quedan pendientes de que el
usuario confirme que Docker está arriba. No se tocó ningún remoto ni
se hizo ningún push en esta parada.

### 16.3 Item 4 — Parte D (4d), S1: cerrar el camino agente → Alice → UTA

**Verificación real de cada superficie antes de tocar nada** (código
leído, no asumido):

- **UI dev (Vite + relay) y navegador:** autentica hoy, en la práctica,
  vía el mismo bypass de loopback que se está cerrando (Origin
  `http://localhost:*` confiado por `isTrustedLocalOrigin`) — no hay un
  flujo de login separado y distinto para dev. Al exigir sesión real
  para escrituras sensibles, la UI sigue funcionando exactamente igual
  siempre que exista una cookie de sesión válida (el flujo de login de
  Alice ya existe end-to-end, `src/services/auth/`, `/api/auth/login`)
  — no se inventó nada nuevo, solo dejó de bypasearse para estas rutas.
- **Electron (`app://` + IPC):** `src/webui/web-ipc.ts` — confirmado
  leyendo el código que sintetiza `remoteAddress: '127.0.0.1'` para
  "mirror loopback HTTP semantics", y que `WebPlugin` (`plugin.ts:414`)
  **nunca llama `serve()`** cuando `config.listen === false` (modo
  Electron) — no hay socket TCP real escuchando en absoluto en ese
  modo, así que ningún proceso externo puede compartir ese puerto con
  la app. Por eso `requireSessionForSensitiveWrites` se pasa `false`
  ahí — el bypass de loopback en Electron no protege nada que un
  atacante externo pudiera alcanzar, porque no hay nada que alcanzar.
- **Telegram:** `src/services/connector-client/uta-review.ts` llama
  `uta.push(request.pendingHash)` directamente sobre el objeto
  `UTAAccountSDK` — in-process, nunca via HTTP contra el propio puerto
  web de Alice. No pasa por `auth.ts` en absoluto.
- **`/cli` (workspace CLI shims):** confirmado que
  `registerCliRoutes(app, {...}, true)` en `plugin.ts` (con
  `manifestOnly=true`) **nunca registra** `POST /cli/:wsId/:export/invoke`
  (retorna antes, `server/cli.ts:287`) — el invoke real, sin auth por
  diseño ("no admin-token gate — the workspace CLI carries no secret"),
  solo se monta vía `LocalToolGatewayPlugin` (puerto MCP separado,
  loopback-only) o, si `OPENALICE_LOCAL_CLI_ON_WEB=1`, vía
  `mountLocalToolGateway` **antes** de `app.use('*', createAuthMiddleware(...))`
  en el propio `plugin.ts` — deliberadamente por encima del gate de
  auth, con un `bindIsPublic` que rechaza arrancar si ese modo se
  combina con un bind no-loopback. Fuera del alcance de S1 tal como el
  usuario lo definió (rutas de trading/simulator/config, no el CLI
  gateway) — **registrado como riesgo conocido, no cerrado en esta
  ronda** (ver `docs/uta-auth.md`, sección de riesgo residual).
- **`tradingPush` (tool de IA):** `src/tool/trading.ts:840` —
  `uta.push(status.pendingHash)`, mismo patrón in-process que Telegram,
  nunca HTTP contra el propio puerto de Alice.

**Cambios:**
- `src/webui/middleware/auth.ts` — `AuthMiddlewareOptions.requireSessionForSensitiveWrites`:
  el bypass de loopback ya no aplica a una escritura bajo
  `/api/trading`, `/api/simulator`, o `/api/config` cuando está
  activado; las lecturas no cambian. `plugin.ts` lo activa exactamente
  cuando hay un socket TCP real (`config.listen !== false`).
- `services/uta/src/http/engine-account-guard.ts` (nuevo) — cuentas
  marcadas `engineOwned: true` en la política RO (`policy.ts`, campo
  nuevo) exigen scope `engine` específicamente para `stage`/`commit`;
  `push` sigue exigiendo `approve` sin cambios, y como `TradingGit`
  solo admite un commit pendiente a la vez, lo que un humano aprueba en
  una cuenta del Engine solo puede ser lo que el propio Engine generó —
  sin mecanismo aparte para rastrear "quién creó este pendingHash".

Salida real (`auth.spec.ts`, suite nueva "Fase 4d (S1)"):

```
✓ default (unset) preserves today's behavior — a loopback trading write bypasses auth with no session
✓ true: a loopback trading write with no session is rejected — no more bypass for /api/trading
✓ true: a loopback simulator write with no session is also rejected
✓ true: a loopback agent-config write with no session is also rejected
✓ true: a loopback trading write WITH a real session cookie still succeeds (the browser UI keeps working)
✓ true: a loopback READ (GET) still bypasses auth with no session — only writes are affected
✓ true: a loopback write OUTSIDE trading/simulator/config still bypasses auth (unaffected surface)
✓ true: a non-loopback caller was already rejected before this option existed, and still is
```

Salida real (`engine-account-guard.spec.ts`, 10/10):

```
✓ compatibility mode (no tokens file) — no-ops entirely, no utaAuth to check
✓ account not marked engineOwned — a stage-only token (no engine scope) still works, unaffected
✓ engineOwned account rejects a stage-scoped token that lacks the engine scope specifically
✓ engineOwned account allows a token that DOES carry the engine scope
✓ engineOwned account still allows commit only from an engine-scoped token too
✓ an engineOwned account rejects staging with Alice's own token shape (read+stage+approve, never engine)
✓ does not gate non-stage routes on an engineOwned account (e.g. reads) — only stage/commit
✓ push is never gated by this guard — a human's approve-scoped token (Alice, never engine) can still push on an engineOwned account
✓ falls back to "default" account policy the same way the RiskEngine does
✓ no risk policy configured at all — no-ops (RiskEngine's own gates handle that separately)
```

Confirmado sin romper las dos superficies in-process, corriendo sus
specs existentes sin ningún cambio (prueba de que este trabajo no las
tocó): `src/services/connector-client/uta-review.spec.ts` y
`src/tool/trading.spec.ts` → 28/28 tests, verde.

**Riesgo residual documentado, no cerrado** (`docs/uta-auth.md`): Alice,
UTA, y cualquier agente de un Workspace siguen siendo el mismo usuario
del SO — un agente con shell puede leer los archivos de Alice
directamente (incluido `OPENALICE_UTA_TOKEN` si puede inspeccionar el
proceso). Este cambio cierra el camino HTTP; el aislamiento real de
sistema de archivos/proceso es trabajo de Fase 10 (contenedores,
montajes RO), no de esta ronda.

### 16.4 Resultado final

```
npx tsc --noEmit (raíz)                     # limpio
npx vitest run src/webui/middleware/auth.spec.ts   # 45/45 (37 preexistentes + 8 nuevos)
npx vitest run src/webui                            # 31/34 archivos, 416/419 tests — 3 fallos preexistentes,
                                                       #   sin relación (mismo hallazgo ya documentado en Fase 4b)
npx vitest run src/services/connector-client/uta-review.spec.ts src/tool/trading.spec.ts
                                                     # 28/28 — Telegram y tradingPush sin cambios
cd services/uta && pnpm typecheck                   # limpio
node scripts/run-tests.mjs --owner uta               # 74/74 archivos, 1266/1266 tests
pnpm test:integration:uta                            # 1/1, 15/15
cd services/uta && pnpm build                        # limpio (350.04 KB)
corepack pnpm exec tsup src/main.ts --format esm --dts   # limpio (warning preexistente, direct-eval, no relacionado)
```

---

## 17. Escaneo de secretos (gitleaks) — 11 hallazgos upstream preexistentes — 2026-09-30

### 17.1 Comando ejecutado

Binario `gitleaks` v8.30.1 obtenido por descarga directa (Docker Desktop
no respondía — `failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine` — con autorización explícita
previa del usuario para usar esta vía de respaldo) desde la release
oficial de GitHub, verificado contra el checksum SHA256 publicado en
`gitleaks_8.30.1_checksums.txt` antes de ejecutarlo. Comando exacto,
corrido desde la raíz del repo:

```
gitleaks.exe detect --source=. --log-opts="--branches" --report-format=json --report-path=report.json --exit-code=0 -v
```

`--log-opts="--branches"` escanea todas las refs de rama locales, no
solo HEAD. Resultado: 3009 commits escaneados (~41.26 MB), **11
hallazgos**, todos de la regla `generic-api-key`.

Este es el comando a repetir antes de cada push (ver también §17.4 más
abajo y el documento dedicado
[[docs/trading-engine/SECRET-SCANNING.md]]).

### 17.2 Clasificación mecánica — los 11 son UPSTREAM

Para cada uno de los 6 commits únicos de origen de los 11 hallazgos, se
ejecutó `git merge-base --is-ancestor <commit> 0d4faa90` (`0d4faa90` =
commit auditado en la Fase 0, §7). Código de salida `0` = es ancestro =
el hallazgo ya es público en TraderAlice/OpenAlice (y por tanto también
en este fork) desde antes de que empezara este trabajo.

| # | Commit | Archivo | Línea | ¿Ancestro de `0d4faa90`? |
|---|---|---|---|---|
| 1 | `bf86cec4` | `patches/@xterm__addon-webgl@0.20.0-beta.286.patch` | 6 | SÍ (exit 0) |
| 2 | `bf86cec4` | `patches/@xterm__addon-webgl@0.20.0-beta.286.patch` | 7 | SÍ (exit 0) |
| 3 | `569b7d83` | `patches/@xterm__xterm@6.1.0-beta.287.patch` | 6 | SÍ (exit 0) |
| 4 | `569b7d83` | `patches/@xterm__xterm@6.1.0-beta.287.patch` | 7 | SÍ (exit 0) |
| 5 | `93daccfa` | `packages/opentypebb/src/providers/eastmoney/models/equity-search.ts` | 23 | SÍ (exit 0) |
| 6-7 | `8786a62c` | `src/webui/routes/trading-config.spec.ts` | 145 | SÍ (exit 0) |
| 8 | `2310a5a1` | `src/domain/trading/brokers/presets.spec.ts` | 43 | SÍ (exit 0) |
| 9 | `2310a5a1` | `src/domain/trading/brokers/others/leverup/LeverupBroker.spec.ts` | 17 | SÍ (exit 0) |
| 10 | `2310a5a1` | `src/domain/trading/brokers/others/leverup/LeverupBroker.spec.ts` | 180 | SÍ (exit 0) |
| 11 | `696a6ae0` | `src/ai-providers/vercel-ai-sdk/vercel-provider.spec.ts` | 61 | SÍ (exit 0) |

**Los 11 son UPSTREAM**, confirmado mecánicamente, no por inferencia.
Ninguno vive en un commit propio de esta sesión. Por diseño, ningún
valor de secreto se reproduce en este documento ni en ningún otro
artefacto del repo — solo commit/archivo/línea/regla.

Forma/contexto de cada grupo (para que un revisor humano entienda el
riesgo real sin necesidad del valor):

- **#1-4** (parches de `xterm`): dentro de JS minificado/empaquetado de
  terceros en archivos `pnpm patch` — falsos positivos por entropía
  sobre código minificado.
- **#5** (constante `TOKEN` en `equity-search.ts`): constante hexadecimal
  de 32 caracteres hardcodeada, usada contra una API pública de
  búsqueda (`searchapi.eastmoney.com`) — posible token de aplicación
  público/no sensible, no confirmado con certeza. Ver
  [[docs/trading-engine/UPSTREAM-agent-probe-auth-token.md]] §"otros
  hallazgos para reportar en privado a upstream".
- **#6-7** (`trading-config.spec.ts:145`): objeto con credenciales de
  prueba cuyos propios nombres indican que son ficticias.
- **#8-9** (mismo valor hex de 66 caracteres en `presets.spec.ts:43` y
  `LeverupBroker.spec.ts:17`, mismo commit): entrada de preset de prueba
  junto a hermanos trivialmente ficticios — muy probablemente una clave
  privada dummy con forma de esquema válido, no confirmado con
  certeza al 100%. Ver también
  [[docs/trading-engine/UPSTREAM-agent-probe-auth-token.md]].
- **#10** (`LeverupBroker.spec.ts:180`): valor evidentemente ficticio por
  su propio contenido.
- **#11** (`vercel-provider.spec.ts:61`): nombre de modelo pasado como
  parámetro `key:`, no una credencial — falso positivo por heurística de
  nombre de campo.

**No se "arreglan"**: no son archivos nuestros, son historia upstream ya
pública. Arreglarlos aquí no eliminaría el secreto del historial
público de TraderAlice/OpenAlice ni de este fork, y reescribir historia
compartida está fuera de alcance y prohibido por este mismo proyecto
(`AGENTS.md` — nunca force-push, nunca reescribir `master`/`dev`).

### 17.3 `.gitleaksignore`

Creado en la raíz del repo con los 10 fingerprints únicos (formato
`commit:archivo:regla:línea`, el campo `Fingerprint` real de gitleaks)
que cubren los 11 hallazgos (#6 y #7 comparten fingerprint — dos
coincidencias en la misma línea). Contiene solo fingerprints, nunca
valores. Verificado real: re-correr el mismo comando del §17.1 con este
archivo presente produce `no leaks found` sobre las mismas 3009
commits/41.26 MB.

### 17.4 Repetición antes de cada push

Procedimiento completo (binario verificado, comando exacto, uso de
`.gitleaksignore`) documentado en
[[docs/trading-engine/SECRET-SCANNING.md]] para repetirlo antes de cada
push futuro.

## Resumen de la línea de tiempo de esta sesión

- Herramientas verificadas: git 2.49.0, Node v24.12.0, pnpm 11.7.0 (vía `corepack pnpm`).
- Repo clonado en `C:\AliceTrader\OpenAlice`; HEAD = commit auditado; rama `feat/engine-f0-audit` creada.
- Documentos de referencia copiados sin modificar a `docs/trading-engine/`.
- Los 10 hallazgos de PROMPT_MASTER §1 y las 6 discrepancias D1–D6 del documento de referencia: **todos CONFIRMADOS**, con archivo:línea de este commit.
- `pnpm install`, `pnpm test:owner:uta` (58/58 archivos, 1055/1055 tests) y `pnpm test:integration:uta` (1/1 archivo, 15/15 tests): **todos en verde**, sin carriles live-paper ni contacto con brokers.
- Línea base completa (§7, previa a Fase 1): `pnpm test` **FALLÓ** (17/7334 tests, 12/854 archivos — ver Grupos A-E en §7.1, todos preexistentes y sin arreglar); `npx tsc --noEmit` en la raíz **PASÓ** limpio; `cd ui && npx tsc -b` **FALLÓ** (23 errores, una sola causa raíz: `packages/connector-protocol` nunca se compiló, `dist/` no existe).
