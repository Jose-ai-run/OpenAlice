# Estado — traspaso de sesión (2026-10-01)

## Ramas y último commit
- `feat/engine-f0-audit` — e8d0bfc7 — Fase 0, baseline auditado (`0d4faa90`).
- `feat/engine-f1-architecture` — 5264f2f1 — cuentas Engine para F2/F3.
- `feat/engine-f2-market-data` — 481a1b52 — Fase 2, market data.
- `feat/engine-f3-strategy-engine` — 6997b15a — Fase 3, strategy engine.
- `feat/engine-f4a-risk-engine` — c10f3c53 — Fase 4a, RiskEngine.
- `feat/engine-f4b-uta-auth` — b448cd54 — Fase 4b, UTA auth.
- `feat/engine-f4c-audit-spread` — 2e6b3595 — Fase 4c, auditoría + R21.
- `feat/engine-hito1-signal-only` — e14581fc — Hito 1 parte 1 (signal-only).
- `feat/engine-f4d-alice-write-path` (**actual/HEAD**) — Hito 1 parte 2 completa + correcciones del canary + F7 (AUDIT.md §18-19, pendiente de commit final de esta sesión).
- `docs/phil-improvements` — 636b917b — enmienda ADR-0009.
- `master` — 0d4faa90 (= `origin/master`) — **nunca commitear/push directo aquí**.
- Remoto `fork` = `https://github.com/Jose-ai-run/OpenAlice.git` — `feat/*`/`docs/*` pusheadas (2026-10-01); secret scanning + push protection `enabled` en el fork.

## Fases completadas
0 → 1 → 2 → 3 → 4a → 4b → 4c → Hito 1 parte 1 (signal-only) → 4d items
0-2 (gitleaks §17) → **Hito 1 parte 2 completa (AUDIT.md §18-19):**

- **3a** mapeo `bybit-readonly|BTC/USDT:USDT` → `engine-paper|BTC/USDT:USDT`
  verificado real contra UTA en vivo.
- **3b** canary PAPER real: ENTER real no fabricado → entrada con stop
  protector real **en la misma operación atómica** (ventana sin stop
  ~0.016s) → STOP_OUT real. Reinicio a mitad de ciclo sin duplicados.
  Kill switch real (rechazo R0 genuino). Cuenta termina plana.
- **3d** `GET /engine/status` + `GET /` reales en `127.0.0.1:47340`;
  `DEMO-LOCAL.md`.
- **Item 1 completo (1a-1e)** — los 3 hallazgos reales que el primer
  canary expuso, todos cerrados: R12/R13 exentan stops protectores;
  R14 reconoce un stop hermano en el mismo commit; `MockBroker` actúa
  de verdad sobre `tpsl` (crea una pata `STP`/`LMT` real); guardia
  anti-huérfanos (nunca abre una posición inversa); **1c** (atomicidad:
  si el stop falla tras la entrada, cierre reduce-only inmediato +
  alerta) implementado y probado en esta vuelta.
- **Item 2 (F5 resto)**: A7b (bid/ask/spread/fee reales en MockBroker,
  M10) + A2 (migración `counterfactual_trades`, solo esquema).
- **F7**: M4 (escritura atómica de `commit.json`), M5 (`pending.json`
  persistido y restaurado), A6 (lease + fencing completo, ADR-0009 con
  sus 4 enmiendas, incluye cliente del lado Engine con reconciliación
  Enmienda 3). M6 no implementado.
- **Hallazgo nuevo en la re-verificación**: cambiar el spread sintético
  fijo de `MockBroker.getQuote()` por uno real (`spreadBps`) hizo que
  R21 rechazara `engine-paper` (bid===ask, tratado por diseño como
  cotización no real) — corregido con `allowSyntheticQuotes: true`
  explícito para esa cuenta en `risk-policy.example.json`, el opt-in
  que el propio R21 prescribe.

## Pendiente, en orden
1. **Commitear y pushear** este cierre de bloque a `fork`.
2. **Item 3c — 24h de estabilidad en vivo (PAPER):** NO iniciar sin
   aprobación explícita — punto de parada acordado.
3. **M6 (clientOrderId)**: no implementado — `StagePlaceOrderParams` sin
   el campo; soporte real en CCXT/Alpaca/IBKR sin verificar.
4. **Scheduler en vivo**: no existe — `main.ts` no tiene bucle
   periódico; `EngineLeaseClient`/reconciliación son código real y
   probado que nadie invoca en producción todavía.
5. **Caos `kill -9`**: no ejecutado — procedimiento manual documentado
   en AUDIT.md §19.6 para correrlo cuando se quiera.
6. **ETH sin mapeo**: `engine-config.canary.json` solo tiene BTC en
   `universe` — ETH no se tradea en el canary (ausencia deliberada, no
   un fallo silencioso).

## Decisiones clave
- Engine separado como servicio: [[docs/adr/0001-engine-as-separate-service.md]].
- `node:sqlite` experimental aceptado para dev: [[docs/adr/0002-sqlite-driver.md]].
- Auth por token UTA: [[docs/adr/0003-uta-token-auth.md]].
- Risk policy como archivo RO: [[docs/adr/0004-risk-policy-ro-file.md]].
- Modos de ejecución: [[docs/adr/0005-execution-modes.md]].
- Herramientas de lectura del Engine: [[docs/adr/0006-engine-read-tools.md]].
- Ledger contrafactual con evidencia fechada: [[docs/adr/0008-dated-evidence-counterfactual-ledger.md]].
- Lease fencing del Engine, **implementado** esta sesión: [[docs/adr/0009-engine-lease-fencing.md]].
- Auditoría independiente: [[docs/adr/0010-independent-audit.md]].
- Registro narrativo completo de cada fase: [[docs/trading-engine/AUDIT.md]]
  (§17 = gitleaks, §18 = Hito 1 parte 2, §19 = cierre del canary + F7).
- `/cli` nunca hereda scope `engine`, verificado real: [[docs/uta-auth.md]].
- Cómo levantar todo localmente: [[docs/trading-engine/DEMO-LOCAL.md]].

## Comandos de verificación habituales
```
npx tsc --noEmit                                   # raíz
cd ui && npx tsc -b                                 # UI
cd services/engine && pnpm run test                 # 27/27 archivos, 127/127 tests
cd services/engine && pnpm run typecheck            # limpio
cd services/uta && pnpm run typecheck               # limpio
pnpm test:owner:uta                                 # 79/79 archivos, 1332/1332 tests
pnpm test:integration:uta                           # 1/1 archivo, 15/15 tests
gitleaks.exe detect --source=. --log-opts="--branches" --report-format=json --report-path=report.json --exit-code=0 -v
                                                     # antes de cada push — ver SECRET-SCANNING.md
```

## Siguiente paso exacto
Commitear + pushear este cierre de bloque a `fork`. Después,
**detenerse** hasta recibir aprobación explícita para el item 3c (24h
en PAPER). No iniciar la prueba de 24h sin esa aprobación.
