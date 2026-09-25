# ADR-0005: Modos de ejecución 1–6 y cálculo del mínimo efectivo

**Estado:** Propuesto — diseño únicamente, **cero implementación en Fase 1**
**Fecha:** 2026-09-24
**Fase:** F1 (Architecture)

## Contexto

PROMPT_MASTER §"HUMAN OVERSIGHT — MODOS" define seis modos ordinales:

```
RESEARCH_ONLY (1) · SIGNAL_ONLY (2) · PAPER (3) · HUMAN_APPROVAL (4) · SEMI_AUTONOMOUS (5) · FULLY_AUTOMATED (6)
```

y la regla: "Modo efectivo = mínimo entre: `ENGINE_MODE`, el
`executionModeMax` de la política RO, el `mode_cap` de la estrategia y el
modo de la cuenta. UTA aplica el techo (no solo el Engine)."

Fase 0 confirmó que hoy **no existe** ningún concepto de modo numérico
ordinal en el repo — lo más cercano es `trading.mode = lite | readonly |
pro` (`src/services/trading-mode.ts`, [VERIFICADO EN REPOSITORIO] citado en
el documento de referencia §2.4-(15)) y `agent.allowAiTrading` (booleano,
`src/core/config.ts:249`). Ninguno de los dos es ordinal ni compone varias
fuentes con un mínimo — son interruptores independientes. Este ADR diseña
el concepto nuevo; no reemplaza ni modifica `trading.mode` (fuera de
alcance de esta fase, y de todas formas ese campo sigue siendo válido para
Alice/UI, un consumidor distinto del Engine).

Por qué "UTA aplica el techo (no solo el Engine)" importa: Fase 0 confirmó
que el RiskEngine (M1) se inserta en UTA como primer paso del dispatcher
(ADR-0004) — si el techo de modo solo viviera en el Engine, un bypass del
Engine (por ejemplo, alguien llamando a UTA directamente, como hoy es
posible sin auth — hallazgo 3 de Fase 0) evadiría el control. El diseño de
abajo asume que UTA es la autoridad final, consistente con ADR-0001
("UTA sigue siendo el único punto de escritura hacia el broker").

## Opciones consideradas

### Opción A — Un solo modo global, sin composición por fuente

- Descartada. No permite lo que PROMPT_MASTER pide explícitamente: que una
  estrategia individual tenga un `mode_cap` más conservador que el modo
  global del Engine (por ejemplo, una estrategia nueva en `SIGNAL_ONLY`
  mientras otras ya probadas corren en `PAPER`), ni que la política del
  host (RO, ADR-0004) imponga un techo que ninguna configuración de
  producto pueda superar.

### Opción B — Mínimo entre 4 fuentes, evaluado en cada punto de decisión — **elegida**

Exactamente como lo especifica PROMPT_MASTER, con la composición
implementada en **dos lugares**, no uno:

1. **Engine** (una fase posterior, no esta): antes de generar una
   `StrategyDecision` accionable, calcula el modo efectivo local y decide
   si genera un `order_intent` o se detiene en `SIGNAL_ONLY`.
2. **UTA** (M1/RiskEngine, otra fase posterior): vuelve a aplicar el mismo
   mínimo (con su propia visión de `executionModeMax` de la política RO y
   el modo de la cuenta) como el techo autoritativo final — sin confiar en
   que el Engine ya lo hizo bien. Esta duplicación deliberada es la
   diferencia entre "UTA aplica el techo" y "el Engine aplica el techo y
   UTA confía en él".

## Decisión (diseño, no implementación)

**Orden ordinal fijo** (no configurable, para que "mínimo" tenga sentido
determinista):

```
1 RESEARCH_ONLY < 2 SIGNAL_ONLY < 3 PAPER < 4 HUMAN_APPROVAL < 5 SEMI_AUTONOMOUS < 6 FULLY_AUTOMATED
```

**Cuatro fuentes, cada una produce un entero 1–6:**

| Fuente | Dónde vive | Quién la cambia |
|---|---|---|
| `ENGINE_MODE` | Variable de entorno del proceso Engine | Operador, requiere reinicio del Engine |
| `executionModeMax` (política RO) | `risk-policy.json` (ADR-0004) | Operador con acceso al host, vía `SIGHUP` |
| `mode_cap` (por estrategia) | `services/engine/config/strategies.yaml` | Operador, vía config del Engine (no vía API) |
| Modo de la cuenta | `accounts.json` de UTA (campo nuevo, fuera de alcance de este ADR definir su forma exacta — se decide cuando M1 se implemente) | Operador, vía UI/config de Alice existente |

**Modo efectivo = `Math.min(...)` de las cuatro**, recalculado en cada
punto de decisión (no cacheado más allá de un ciclo del Engine), para que
un cambio de política RO por `SIGHUP` tenga efecto sin reiniciar el
Engine.

**Modo 5 (`SEMI_AUTONOMOUS`) — regla especial de PROMPT_MASTER, heredada
sin cambios:** "el push automático solo ocurre si el intent está dentro de
un 'sobre automático' más estrecho que la política; si no, pasa a
aprobación humana." Este ADR no define la forma exacta de ese "sobre" —
queda para la fase que implemente el modo 5 (probablemente F7/F8, después
de que exista ExecutionManager).

**Auditoría:** cada cambio de modo efectivo (por cualquiera de las cuatro
fuentes) se registra — mismo principio que `policyHash` en cada decisión
de riesgo (ADR-0004): sin esto, "modo efectivo" sería un estado invisible
que nadie podría reconstruir después de un incidente.

## Consecuencias

- Dos implementaciones del mismo cálculo (Engine y UTA) es deliberadamente
  redundante — no es un descuido de DRY. Diverger entre ellas es aceptable
  siempre que UTA sea siempre igual o más estricto que el Engine (UTA
  nunca debe confiar ciegamente en que el Engine ya aplicó el techo
  correcto).
- El campo "modo de la cuenta" en `accounts.json` todavía no existe — este
  ADR lo anticipa pero no lo diseña en detalle (su esquema Zod exacto es
  trabajo de la fase que module `src/core/config.ts`, fuera de alcance de
  Fase 1).

## Cómo revertirla

Mientras no haya implementación (Fases 1–3), no hay nada que revertir. Una
vase implementado, revertir a comportamiento actual es equivalente a fijar
las cuatro fuentes a su máximo (6) — comportamiento indistinguible de "sin
techo de modos", que es el estado de hoy (ni siquiera existe el concepto).
