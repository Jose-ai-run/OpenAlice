# ADR-0008: Evidencia fechada + ledger contrafactual (A2, A4)

**Estado:** Propuesto — diseño únicamente, **cero implementación en esta ronda**
**Fecha:** 2026-09-27
**Fase:** F6 (campos preparados desde F5)

## Contexto

Registra el diseño de A2 (ledger contrafactual) y A4 (evidencia
fechada) del análisis de `bennyjo/phil`
(`docs/trading-engine/BACKLOG.md`). Ambas responden al mismo problema
de fondo que motivó no integrar Phil: sin un ledger de qué se
**bloqueó** y sin fechar cuándo empezó a contar la evidencia de una
versión de estrategia, es imposible distinguir "esta estrategia
funciona" de "esta estrategia funciona con el sesgo de supervivencia de
solo contar los trades que sí se ejecutaron, sobre parámetros que ya
cambiamos varias veces desde que empezamos a medir."

**A4 — evidencia fechada.** Hoy (`services/uta/src/domain/trading/risk/`)
el estado persistido es por-cuenta, no por-versión-de-estrategia — no
existe todavía el concepto de "versión de estrategia" en absoluto fuera
de `services/engine/src/strategies/*.ts` (código, no un registro con
timestamp). ADR-0002 ya decidió SQLite para el Engine (Fase 1,
[VERIFICADO EN REPOSITORIO] `docs/adr/0002-sqlite-driver.md`); este ADR
asume esa base de datos como el lugar natural para una tabla
`strategies` con `frozen_at`, no un archivo nuevo.

**A2 — ledger contrafactual.** El RiskEngine (`risk-engine.ts`,
Fase 4a) ya registra cada decisión en `risk-decisions.jsonl`
(`risk-log.ts`, [VERIFICADO EN REPOSITORIO]) — pero solo el veredicto
final (`allowed`, `ruleCode`, `reason`), nunca qué habría pasado si la
señal bloqueada se hubiera ejecutado. Sin eso, cada rechazo de R14
(falta stop) o de una regla futura de advisory (F8+) es una decisión
que nunca se puede evaluar retroactivamente — no hay forma de saber si
el RiskEngine está protegiendo capital real o dejando dinero sobre la
mesa.

## Opciones consideradas

### Opción A — Registrar el contrafactual dentro de `risk-decisions.jsonl`

- Descartada. Ese archivo es un log de auditoría de decisiones de
  riesgo (consumido por A5/ADR-0010 para verificar que cada operación
  ejecutada tuvo su PASS) — mezclar ahí el resultado *simulado* de una
  señal que nunca se ejecutó le cambia el propósito y complica la
  auditoría de "esto sí se ejecutó" vs "esto es una simulación".

### Opción B — Ledger contrafactual como tabla SQLite separada, resuelta por un job async — **elegida**

## Decisión (diseño, no implementación)

**A4 — esquema (delta SQLite, migración nueva, F6):**

```
strategies: + frozen_at (timestamp, NOT NULL una vez en PAPER)
```

Regla: al promover una estrategia a PAPER, `frozen_at = now()`. Cualquier
cambio posterior de parámetros o de código de esa estrategia **no
actualiza la fila existente** — crea una fila nueva (nueva versión) con
su propio `frozen_at` y su propio contador de evidencia en cero. Los
gates de promoción (F6, código determinista — no juicio humano ad hoc)
solo cuentan decisiones con `created_at >= frozen_at` de la versión
vigente. El evaluador de gates emite informe únicamente cuando hay
datos suficientes (umbral a fijar en el propio gate, no en este ADR —
regla general del mandato: "los umbrales de gates se fijan en los ADRs
antes de ver resultados").

**A2 — esquema (delta SQLite, migración nueva, F6, campos preparados
desde F5):**

```
counterfactual_trades(
  cf_id PK,
  decision_id FK,          -- referencia a la decisión bloqueada (risk-decisions.jsonl o la tabla decisions de F6)
  source CHECK IN ('risk_reject','advisory_veto','advisory_reduce','conflict','size_below_min','near_miss'),
  rule_or_reason,          -- p.ej. 'R14' para risk_reject, o el motivo textual para advisory_veto
  side, entry_price, stop_price, target_price,
  sim_fill_json,           -- el mismo modelo de fills que paper (A7b) aplicado a la señal bloqueada
  outcome, net_pnl, r_multiple,
  resolved_at,             -- cuándo la barra de resolución (stop/target/time-stop) cerró
  fold,                    -- partición walk-forward — ver más abajo
  created_at
)
```

**Resolución:** cada señal bloqueada se resuelve con las **mismas**
barras cerradas que habría usado un trade real (stop/target/time-stop
originales de la señal, antes de que el bloqueo la detuviera) —
reutiliza el mismo motor de simulación de fills que paper (A7b), nunca
un modelo de fills distinto que le daría una ventaja o desventaja
artificial frente a los trades reales con los que se compara.

**Folds walk-forward:** particiones temporales no solapadas (mismo
principio de no-lookahead que `buildStrategyContext`,
`services/engine/src/strategies/context-builder.ts`, ya garantiza para
las estrategias reales — un contrafactual resuelto con datos de un fold
posterior al que originó la señal sería el mismo tipo de fuga que ese
código ya existe para prevenir en el camino real).

**Informe:** por fuente (`source`) y por regla/motivo
(`rule_or_reason`), con n, PnL, expectativa y el desglose por fold —
permite responder concretamente "¿R14 está protegiendo capital o
dejándolo sobre la mesa?" con datos, no con intuición.

## Consecuencias

- El ledger contrafactual **nunca** alimenta una decisión de trading en
  vivo — es un instrumento de medición retroactiva, resuelto siempre
  después del hecho. Confundir esto con una señal que sí opera sería
  X3 (reversión a posteriori como protección) o peor, X4 (el LLM/una
  heurística derivada del contrafactual decidiendo sizing) — ambas
  explícitamente rechazadas.
- Requiere que F5 ya calcule y adjunte `sim_fill_json` en el momento de
  la decisión bloqueada (no solo en el trade real) — trabajo real de F5
  preparando los campos que F6 consume, tal como el propio backlog lo
  ordena.

## Cómo revertirla

Ninguna decisión de riesgo ni de estrategia lee esta tabla — es
puramente de análisis. Dejar de escribir en `counterfactual_trades` (o
borrar la tabla) no cambia el comportamiento de trading en absoluto,
solo pierde la capacidad de auditar retroactivamente las señales
bloqueadas.
