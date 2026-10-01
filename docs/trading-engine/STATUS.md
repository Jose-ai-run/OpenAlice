# Estado — traspaso de sesión (2026-09-30)

## Ramas y último commit
- `feat/engine-f0-audit` — e8d0bfc7 — Fase 0, baseline auditado (`0d4faa90`).
- `feat/engine-f1-architecture` — 5264f2f1 — cuentas Engine para F2/F3.
- `feat/engine-f2-market-data` — 481a1b52 — Fase 2, market data.
- `feat/engine-f3-strategy-engine` — 6997b15a — Fase 3, strategy engine.
- `feat/engine-f4a-risk-engine` — c10f3c53 — Fase 4a, RiskEngine.
- `feat/engine-f4b-uta-auth` — b448cd54 — Fase 4b, UTA auth.
- `feat/engine-f4c-audit-spread` — 2e6b3595 — Fase 4c, auditoría + R21.
- `feat/engine-hito1-signal-only` — e14581fc — Hito 1 parte 1 (signal-only).
- `feat/engine-f4d-alice-write-path` (**actual/HEAD**) — 2dc84b89 — Fase 4d + gitleaks (§17 AUDIT.md).
- `docs/phil-improvements` — 636b917b — enmienda ADR-0009.
- `master` — 0d4faa90 (= `origin/master`) — **nunca commitear/push directo aquí**.

## Fases completadas
0 (audit) → 1 (arquitectura) → 2 (market data) → 3 (strategy engine) →
4a (risk engine) → 4b (UTA auth) → 4c (auditoría independiente + R21) →
Hito 1 parte 1 (signal-only) → 4d items 0-2 (`/cli` no hereda scope
engine, `MEJORAS_DESDE_PHIL.md` copiado, 11 hallazgos gitleaks
clasificados como upstream — `AUDIT.md` §17, `.gitleaksignore`,
`SECRET-SCANNING.md`).

## Pendiente, en orden
1. **Item 3 (BLOQUEADO):** push a remoto `fork` = `Jose-ai-run/OpenAlice.git`
   → falla con "Repository not found". Esperando que el usuario cree el
   repo o corrija credenciales/URL antes de reintentar
   `git push fork feat/* docs/* ` (nunca `master`, nunca `--force`).
2. **Hito 1 parte 2 — item 3a:** mapeo de instrumentos (símbolo
   bybit-readonly → contrato engine-paper), verificado por búsqueda real
   contra la cuenta mock; símbolo sin mapeo válido no se tradea y queda
   logueado.
3. **Item 3b — canary replay en PAPER:** ventana histórica real con
   señal genuina de `trend_following`, reloj simulado, camino completo
   Engine→UTA→RiskEngine→TradingGit; ≥1 operación completa (entrada+stop
   →salida) visible en Trading-as-Git; más kill switch y restart
   mid-ciclo sin duplicados. **Detenerse aquí y mostrar evidencia real
   antes de continuar.**
4. **Item 3c — 24h de estabilidad en vivo (PAPER):** NO iniciar sin
   aprobación explícita tras ver evidencia del canary.
5. **Item 3d:** página de estado read-only (`127.0.0.1:47340`) +
   `DEMO-LOCAL.md` (login con sesión, regeneración de admin token sin
   escribir el valor).

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
  (§17 = clasificación gitleaks, 2026-09-30).
- `/cli` nunca hereda scope `engine`, verificado real: [[docs/uta-auth.md]].

## Comandos de verificación habituales
```
npx tsc --noEmit                                   # raíz
cd ui && npx tsc -b                                 # UI
node scripts/run-tests.mjs --owner uta              # suite UTA
pnpm test:integration:uta                           # integración UTA
pnpm test:changed                                   # cierre hermético vs origin/dev
gitleaks.exe detect --source=. --log-opts="--branches" --report-format=json --report-path=report.json --exit-code=0 -v
                                                     # antes de cada push — ver SECRET-SCANNING.md
```

## Siguiente paso exacto
Resolver el push bloqueado (item 3) y, en cuanto se desbloquee o se
decida saltarlo, **continuar directamente con Hito 1 parte 2, item 3a**
(mapeo de instrumentos) → 3b (canary) → detenerse a mostrar evidencia
del canary antes de las 24h.
