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
- `feat/engine-f4d-alice-write-path` (**actual/HEAD**) — Hito 1 parte 2 + cierre del canary/F7 + F6 backtesting (AUDIT.md §18-20), pendiente de commit final.
- `docs/phil-improvements` — 636b917b — enmienda ADR-0009.
- `master` — 0d4faa90 (= `origin/master`) — **nunca commitear/push directo aquí**.
- Remoto `fork` = `https://github.com/Jose-ai-run/OpenAlice.git` — `feat/*`/`docs/*` pusheadas; secret scanning + push protection `enabled`.

## Fases completadas
0 → 1 → 2 → 3 → 4a → 4b → 4c → Hito 1 parte 1 → 4d items 0-2 (gitleaks
§17) → Hito 1 parte 2 + cierre del canary/F7 (§18-19) → **F6
backtesting con criterio de corte (§20):**

- ADR-0011 pre-registrado y commiteado (`542c52cd`) ANTES de descargar
  un dato o correr un backtest: universo BTC/ETH perp, 23 combinaciones
  × 2 activos × 2 intervalos = 92 variantes, costos conservadores, WF
  12m/3m, holdout 6m, 8 gates (incluido Sharpe ajustado por Bonferroni
  N=92), A3/A4, criterio de corte mecánico.
- Dataset real descargado y paginado: BTC 57,148 velas 1h
  (2020-03-25→2026-10-01), ETH 48,638 velas 1h (2021-03-15→2026-10-01),
  0 huecos/duplicados/OHLC inválido. 4h derivado, nunca descargado
  aparte.
- Backtester event-driven real (`services/engine/src/backtest/*`) —
  reutiliza `buildStrategyContext`/`strategy.evaluate()`/`sizePosition`
  sin duplicar lógica. Walk-forward + bootstrap (PRNG sembrado) + A3
  (Spearman por quintil) + los 8 gates.
- **Resultado: 0/92 combinaciones pasaron walk-forward.** Ninguna llegó
  a holdout. **DECISIÓN mecánica: DETENER la inversión en el motor.**
  Tabla completa + candidato más cercano (falla igual) + comparación
  buy-and-hold + limitaciones: [[docs/trading-engine/BACKTEST-REPORT.md]].
- Item 6 (menor): `spreadBps`/`slippageBps`/`feeBps` ahora de punta a
  punta en el preset `mock-simulator` + `MockBroker.fromConfig`;
  `allowSyntheticQuotes` retirado de `engine-paper` en
  `risk-policy.example.json`. **Pendiente de aplicar en la cuenta real**
  (sellada, local) — ver AUDIT.md §20.4 para el paso exacto.

## Pendiente, en orden
1. **Commitear y pushear** este bloque F6 a `fork`.
2. **Item 3c (24h PAPER)**: sigue sin iniciar — punto de parada
   acordado, no relacionado con F6.
3. **Aplicar `spreadBps` real a `engine-paper`** localmente (AUDIT.md
   §20.4) para que R21 vuelva a proteger esa cuenta sin
   `allowSyntheticQuotes`.
4. **M6 (clientOrderId)**, **scheduler en vivo**, **caos `kill -9`**:
   siguen pendientes, sin cambios desde §19.6.
5. **Decisión de producto sobre el motor**: el backtest F6 recomienda
   DETENER la inversión en las estrategias A-E tal como están
   pre-registradas — cualquier paso siguiente (nuevas estrategias, otro
   universo, etc.) requiere un ADR de pre-registro nuevo, nunca una
   edición de ADR-0011.

## Decisiones clave
- Engine separado como servicio: [[docs/adr/0001-engine-as-separate-service.md]].
- `node:sqlite` experimental aceptado para dev: [[docs/adr/0002-sqlite-driver.md]].
- Auth por token UTA: [[docs/adr/0003-uta-token-auth.md]].
- Risk policy como archivo RO: [[docs/adr/0004-risk-policy-ro-file.md]].
- Modos de ejecución: [[docs/adr/0005-execution-modes.md]].
- Herramientas de lectura del Engine: [[docs/adr/0006-engine-read-tools.md]].
- Ledger contrafactual con evidencia fechada: [[docs/adr/0008-dated-evidence-counterfactual-ledger.md]].
- Lease fencing del Engine, implementado: [[docs/adr/0009-engine-lease-fencing.md]].
- Auditoría independiente: [[docs/adr/0010-independent-audit.md]].
- Pre-registro del backtest F6, DECISIÓN=DETENER: [[docs/adr/0011-backtest-preregistration.md]] + [[docs/trading-engine/BACKTEST-REPORT.md]].
- Registro narrativo completo de cada fase: [[docs/trading-engine/AUDIT.md]]
  (§17 gitleaks, §18 Hito 1 parte 2, §19 cierre canary+F7, §20 F6).
- `/cli` nunca hereda scope `engine`, verificado real: [[docs/uta-auth.md]].
- Cómo levantar todo localmente: [[docs/trading-engine/DEMO-LOCAL.md]].

## Comandos de verificación habituales
```
npx tsc --noEmit                                   # raíz
cd ui && npx tsc -b                                 # UI
cd services/engine && pnpm run test                 # 34/34 archivos, 168/168 tests
cd services/engine && pnpm run typecheck            # limpio
cd services/uta && pnpm run typecheck               # limpio
pnpm test:owner:uta                                 # 79/79 archivos, 1332/1332 tests
pnpm test:integration:uta                           # 1/1 archivo, 15/15 tests
gitleaks.exe detect --source=. --log-opts="--branches" --report-format=json --report-path=report.json --exit-code=0 -v
                                                     # antes de cada push — ver SECRET-SCANNING.md
```

## Siguiente paso exacto
Commitear + pushear el bloque F6 a `fork`. El backtest dio DECISIÓN=
DETENER — no hay "siguiente fase de inversión" automática; cualquier
continuación requiere decisión humana explícita sobre qué hacer con
ese resultado (aceptar el corte, o pre-registrar un ADR nuevo con un
universo/grilla distintos). Item 3c (24h PAPER) sigue, por separado,
a la espera de su propia aprobación.
