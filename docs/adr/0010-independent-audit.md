# ADR-0010: Auditoría independiente (A5)

**Estado:** Propuesto — diseño únicamente, **cero implementación en esta ronda**
**Fecha:** 2026-09-27
**Fase:** F4c (Fase 4c de este mandato)

## Contexto

Registra el diseño de A5 del análisis de `bennyjo/phil`
(`docs/trading-engine/BACKLOG.md`). El RiskEngine (Fase 4a) y el auth
de scopes (Fase 4b) son ambos controles **preventivos** — deciden antes
de que una operación llegue al broker. Ninguno de los dos verifica,
después del hecho, que el sistema completo se comportó de forma
consistente consigo mismo: que toda operación que de verdad llegó a
`TradingGit` tuvo su aprobación correspondiente, bajo la política que
estaba vigente en ese momento, y sin que el kill switch estuviera
activo. Un control preventivo con un bug (o un camino no cubierto
todavía, como el que S1/Fase 4d va a cerrar) puede fallar en silencio;
una auditoría independiente que corre por separado y compara dos
fuentes de verdad es la única forma de detectarlo sin depender de que
el propio control que podría estar fallando se audite a sí mismo.

**Hallazgo real necesario para diseñar esto** (no en el documento de
Phil — de inspeccionar el código real de esta fase):
`RiskDecisionLogEntry` (`services/uta/src/domain/trading/risk/risk-log.ts`,
[VERIFICADO EN REPOSITORIO]) no incluye ningún campo que correlacione
la decisión con el commit de `TradingGit` que eventualmente produjo (si
`allowed: true`). Los tipos de commit sí llevan `hash: CommitHash`
(`PushResult`, `CommitPrepareResult`, packages/uta-protocol/src/types/git.ts,
[VERIFICADO EN REPOSITORIO]), pero nada conecta hoy una línea de
`risk-decisions.jsonl` con el hash de commit que resultó de ella. Sin
esa correlación, "verificar que cada operación ejecutada tenga su PASS"
solo se puede hacer por aproximación (mismo `accountId` + `timestamp`
cercano + `operationAction` igual) — fràgil, no una prueba. Este ADR
decide cerrar esa brecha como parte del propio mecanismo de auditoría,
no como un hallazgo aparte a resolver "algún día".

## Opciones consideradas

### Opción A — Correlación aproximada por timestamp/cuenta/acción, sin cambiar el esquema

- Descartada. Es exactamente el tipo de correlación frágil que un
  auditor de seguridad no debería aceptar como evidencia — dos
  operaciones legítimas del mismo tipo, en la misma cuenta, con
  segundos de diferencia, son indistinguibles por este método. Una
  auditoría que puede dar falsos negativos (no detecta una operación
  sin PASS porque la emparejó con la fila equivocada) es peor que no
  tener auditoría, porque da falsa confianza.

### Opción B — Añadir el hash de commit a `risk-decisions.jsonl` en el momento del push, correlación exacta — **elegida**

## Decisión (diseño, no implementación)

**Cambio de esquema mínimo (no es una migración SQLite — este archivo
sigue siendo JSONL, UTA-side, sin SQLite todavía en esta fase):**
`RiskDecisionLogEntry` gana un campo opcional `resultingCommitHash?:
string`, poblado únicamente cuando el veredicto fue `allowed: true` y
la operación efectivamente produjo un commit — el punto de escritura
natural es donde `UnifiedTradingAccount`/`TradingGit` ya conocen el hash
resultante, después de que el RiskEngine ya aprobó. Sin este campo, la
Opción A es la única disponible — de ahí que este ADR lo trate como
parte del propio mecanismo, no como un "nice to have" aparte.

**El job de auditoría** (`services/uta/src/domain/trading/risk/audit/`,
nuevo — ejecuta al arrancar UTA y una vez al día vía `setInterval`,
mismo patrón que el `catalogRefreshTimer` ya existente en `main.ts`,
[VERIFICADO EN REPOSITORIO]):

1. Para cada cuenta, lee el log de commits de `TradingGit`
   (`uta.exportGitState().commits`, ya usado por
   `order-history.ts`/`trade-history.ts`, [VERIFICADO EN REPOSITORIO])
   y `risk-decisions.jsonl`.
2. Para cada commit cuya operación pase por el RiskEngine
   (`placeOrder`/`modifyOrder` — `closePosition`/`cancelOrder` siempre
   se permiten por diseño, ADR-0004, y por tanto no tienen ni necesitan
   una entrada de RiskEngine que verificar), verifica:
   - Existe una entrada en `risk-decisions.jsonl` con
     `resultingCommitHash` igual al hash del commit, y `allowed: true`.
   - El `policyHash` de esa entrada coincide con el hash de la política
     vigente **en el momento de esa decisión** (no la política actual —
     requiere conservar o poder recomputar el hash histórico; si la
     política RO no se versiona con su propio historial, el job solo
     puede verificar contra la política actual y debe declarar
     explícitamente esa limitación en su salida, no fingir una
     verificación que no hizo).
   - El `killSwitch` registrado en esa entrada no era `HALT_NEW` ni
     `FLATTEN` en el momento de la decisión.
3. Cualquier discrepancia (commit sin PASS, PASS con hash de política
   que no corresponde, o PASS registrado con el kill switch ya activo)
   → **fuerza `HALT_NEW`** para esa cuenta (mismo verdict shape que
   `persistOrForceHalt()` ya usa en Fase 4a, [VERIFICADO EN REPOSITORIO]
   `risk-engine.ts`), emite una alerta (`console.error`, mismo patrón
   que el resto de Fase 4a/4b), y escribe una entrada en
   `data/trading/<accountId>/_risk/audit.jsonl` con los hallazgos.
4. Un ledger consistente no produce ninguna alerta ni entrada — la
   ausencia de `audit.jsonl` (o un `audit.jsonl` sin discrepancias) es
   el estado esperado en operación normal.

**En CI:** valida el esquema (Zod) de la política de ejemplo
(`deploy/examples/risk-policy.example.json`, ADR-0004) y del estado de
riesgo persistido — un test que corre sin necesitar UTA levantado,
igual que los tests unitarios de `policy.ts`/`risk-state.ts` ya lo
hacen hoy.

**A7a comparte esta fase (F4c) pero no ADR propio:** la regla R21
(`maxSpreadBps`) es una regla R* más, del mismo patrón que R0–R20 —
`services/uta/src/domain/trading/risk/rules/r21-max-spread.ts`, sin
necesitar su propio documento de diseño más allá de lo ya registrado en
`docs/trading-engine/BACKLOG.md`. Antes de implementarla, verificar
contra el código real qué expone `Quote` hoy
(`services/uta/src/domain/trading/brokers/types.ts` y cada broker pack)
y documentar explícitamente cualquier broker que no entregue bid/ask —
sin inventar un valor sintético para uno que no lo dé.

## Consecuencias

- Todo lugar donde hoy se llama `appendRiskDecision()` después de un
  push exitoso necesita, además, el hash resultante — un cambio de
  firma pequeño pero que toca las tres funciones `finalize*` de
  `risk-engine.ts` (Fase 4a). No se implementa en esta ronda; queda
  registrado para cuando F4c lo aborde.
- El job de auditoría corre con acceso de lectura a todo el estado de
  riesgo y de git de cada cuenta — es, en sí mismo, un componente
  privilegiado. No escribe la política ni el estado de riesgo salvo
  para forzar `HALT_NEW` (mismo mecanismo ya existente, no uno nuevo) y
  para su propio log de hallazgos.
- Como con el resto de Fase 4, todo esto va detrás de
  `OPENALICE_RISK_ENGINE_ENABLED` — con el flag apagado, no hay
  decisiones de RiskEngine que auditar y el job no tiene trabajo que
  hacer (debe detectar este caso y no fallar ni alertar por ausencia de
  datos cuando el flag simplemente está apagado a propósito).

## Cómo revertirla

El job de auditoría es puramente de lectura salvo por forzar
`HALT_NEW` (un estado ya reversible por el mecanismo existente de
`resetKillSwitch`) y por escribir su propio log — desactivarlo (no
arrancarlo, o no programarlo en el `setInterval` diario) no cambia
ningún comportamiento de trading, solo deja de detectar discrepancias
retroactivamente.
