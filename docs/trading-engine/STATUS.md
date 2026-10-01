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
- `feat/engine-f4d-alice-write-path` (**actual/HEAD**) — Hito 1 parte 2 (mapeo + canary PAPER real + status page + kill switch + reinicio sin duplicados — `AUDIT.md` §18, pendiente de commit final de esta sesión).
- `docs/phil-improvements` — 636b917b — enmienda ADR-0009.
- `master` — 0d4faa90 (= `origin/master`) — **nunca commitear/push directo aquí**.
- Remoto `fork` = `https://github.com/Jose-ai-run/OpenAlice.git` — **push exitoso** de todas las ramas `feat/*`/`docs/*` (2026-10-01); secret scanning + push protection confirmados `enabled` en el fork vía `gh api`.

## Fases completadas
0 (audit) → 1 (arquitectura) → 2 (market data) → 3 (strategy engine) →
4a (risk engine) → 4b (UTA auth) → 4c (auditoría independiente + R21) →
Hito 1 parte 1 (signal-only) → 4d items 0-2 (`/cli` no hereda scope
engine, `MEJORAS_DESDE_PHIL.md` copiado, 11 hallazgos gitleaks
clasificados como upstream — `AUDIT.md` §17) →
**Hito 1 parte 2, items 3a+3b+3d (AUDIT.md §18):**
- 3a: mapeo `bybit-readonly|BTC/USDT:USDT` → `engine-paper|BTC/USDT:USDT`
  verificado real contra UTA en vivo (ambas cuentas confirmadas por
  `GET /api/trading/uta`).
- 3b: canary PAPER real — ENTER real (2026-08-02T05:00Z, no fabricado)
  → entrada con stop protector (commit separado por un hallazgo real de
  R13/cooldown) → STOP_OUT real (2026-08-02T10:00Z) vía `/sync`. Prueba
  de reinicio a mitad de ciclo: cero duplicados (regla existente de
  TradingGit). Kill switch real vía `routes-risk.ts` nuevo (R0 rechazó
  una orden de prueba; reset a NORMAL después). Cuenta `engine-paper`
  terminó plana.
- 3d: `GET /engine/status` + `GET /` reales en `127.0.0.1:47340`
  (`main.ts` ahora carga config+DB+UTA; antes "Fase 1 skeleton, cero
  lógica"). `DEMO-LOCAL.md` escrito (comandos exactos, login/rotación
  del admin token de Alice sin escribir el valor).
- **3 hallazgos reales nuevos, documentados sin arreglar** (fuera de
  alcance de este Hito): R14 no tiene conciencia entre operaciones del
  mismo commit; R13 bloquea el stop protector del mismo símbolo que
  acaba de operar; `MockBroker.placeOrder` ignora `tpsl` por completo.

## Pendiente, en orden
1. **Commitear y pushear** el trabajo de Hito 1 parte 2 (archivos ya
   escritos y probados, pendiente de `git add`/commit/push a `fork` en
   esta misma rama).
2. **Item 3c — 24h de estabilidad en vivo (PAPER):** NO iniciar sin
   aprobación explícita — el canary ya mostró evidencia real; este es
   el punto de parada acordado.
3. (Más adelante, fuera de este Hito) Decidir si/cómo corregir los 3
   hallazgos de R13/R14/tpsl arriba — requiere ADR si se toca
   RiskEngine o MockBroker.

## Decisiones clave
- Engine separado como servicio: [[docs/adr/0001-engine-as-separate-service.md]].
- `node:sqlite` experimental aceptado para dev: [[docs/adr/0002-sqlite-driver.md]].
- Auth por token UTA: [[docs/adr/0003-uta-token-auth.md]].
- Risk policy como archivo RO: [[docs/adr/0004-risk-policy-ro-file.md]].
- Modos de ejecución: [[docs/adr/0005-execution-modes.md]].
- Herramientas de lectura del Engine: [[docs/adr/0006-engine-read-tools.md]].
- Ledger contrafactual con evidencia fechada: [[docs/adr/0008-dated-evidence-counterfactual-ledger.md]].
- Lease fencing del Engine: [[docs/adr/0009-engine-lease-fencing.md]].
- Auditoría independiente: [[docs/adr/0010-independent-audit.md]].
- Registro narrativo completo de cada fase: [[docs/trading-engine/AUDIT.md]]
  (§17 = gitleaks, §18 = Hito 1 parte 2 — mapeo/canary/status page).
- `/cli` nunca hereda scope `engine`, verificado real: [[docs/uta-auth.md]].
- Cómo levantar todo localmente, login de Alice, rotación del admin
  token: [[docs/trading-engine/DEMO-LOCAL.md]].

## Comandos de verificación habituales
```
npx tsc --noEmit                                   # raíz
cd ui && npx tsc -b                                 # UI
cd services/engine && pnpm run test                 # 26/26 archivos, 121/121 tests
cd services/engine && pnpm run typecheck            # limpio
cd services/uta && pnpm run typecheck               # limpio
node scripts/run-tests.mjs --path services/uta/src/http/routes-risk.spec.ts   # 6/6 tests
pnpm test:integration:uta                           # integración UTA
gitleaks.exe detect --source=. --log-opts="--branches" --report-format=json --report-path=report.json --exit-code=0 -v
                                                     # antes de cada push — ver SECRET-SCANNING.md
```

## Siguiente paso exacto
Commitear + pushear Hito 1 parte 2 a `fork`. Después, **detenerse**
(punto de parada acordado) hasta recibir aprobación explícita para el
item 3c (24h en PAPER). No iniciar la prueba de 24h sin esa aprobación.
