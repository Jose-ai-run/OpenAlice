# ADR-0001: Motor de estrategias como proceso aparte (`services/engine`)

**Estado:** Aceptado
**Fecha:** 2026-09-24
**Fase:** F1 (Architecture)

## Contexto

`PROMPT_MASTER_CLAUDE_CODE.md` §2 exige un sistema que analice mercado, clasifique
régimen, ejecute estrategias determinísticas, dimensione posiciones, genere
órdenes y las ejecute vía UTA, monitoree posiciones y gestione stops/TP/
trailing, con límites de riesgo deterministas que la IA no pueda alterar.

`AGENTS.md` (leído en Fase 0, [DOCUMENTACIÓN]) fija dos reglas de arquitectura
que condicionan directamente esta decisión:

> "`services/uta/` owns brokers, accounts, approvals, snapshots, FX, and
> trading writes. Do not move broker state back into Alice."

> "Do not grow a parallel workflow engine in `src/`… New agent-facing
> capabilities normally ship as Workspace templates, skills, or satellite
> repositories."

`docs/project-structure.md` (Fase 0, [DOCUMENTACIÓN]) documenta la topología
actual de procesos bajo Guardian: Alice (`:47331`), UTA (`:47333`, autoridad
de trading) y Connector (`:47334`, opcional, supervisado con `RestartBackoff`).
No hay un cuarto proceso hoy.

## Opciones consideradas

### Opción A — Dentro de `src/` (Alice)

Añadir el motor como un módulo más de Alice (`src/domain/engine/` o similar).

- Descartada. Viola literalmente la regla de `AGENTS.md` citada arriba
  ("Do not grow a parallel workflow engine in `src/`"). Además, Alice ya no
  tiene estado de broker por diseño (§2.4-(7) del documento de referencia,
  [VERIFICADO EN REPOSITORIO]); meter un motor de trading ahí reintroduciría
  esa responsabilidad exactamente donde `AGENTS.md` dice que no va.

### Opción B — Harness satélite (como AutoQuant V2 / Auto Prediction)

Modelarlo como un Harness fuente-respaldado (`src/workspaces/templates/`),
al estilo `auto-quant-v2` o `auto-prediction` (`docs/project-structure.md`,
sección "Workspace Architecture", [VERIFICADO EN REPOSITORIO]).

- Descartada para el camino crítico de ejecución. Los Harnesses satélite
  son repositorios de investigación con Coding Agent propio, pensados para
  "Projects, Studies, experiments" (`docs/project-structure.md`), no procesos
  supervisados 24/7 con un contrato HTTP estable. Además, PROMPT_MASTER §21
  exige que el LLM quede **fuera del camino crítico** — un Harness es, por
  construcción, la casa de un agente de código, lo que empuja en la
  dirección opuesta. AutoQuant V2 puede seguir siendo el lugar de
  investigación de factores/carteras (§2.4-(21) del documento de referencia);
  no reemplaza la necesidad de un proceso determinista sin LLM en el loop.

### Opción C — Proceso aparte (`services/engine`), patrón Connector — **elegida**

Un servicio Node más bajo Guardian, con el mismo patrón que
`services/connector`: opcional, supervisado con `RestartBackoff`, loopback
por defecto, sin bucle de agente LLM propio.

- Respeta ambas reglas de `AGENTS.md` sin excepción: no toca `src/`, no
  mueve estado de broker, y es un proceso nuevo (no un "parallel workflow
  engine" dentro de uno existente).
- Reutiliza infraestructura ya probada: `packages/guardian-runtime`
  (`RestartBackoff`, locks), el patrón de arranque de `services/uta/src/main.ts`
  y `services/connector/src/main.ts` (Hono + `@hono/node-server`, bind
  `127.0.0.1`, `SIGTERM`/`SIGINT` → shutdown limpio) — todo [VERIFICADO EN
  REPOSITORIO] en Fase 0.
- El Engine se conecta a UTA como **un cliente autenticado más**
  (ver ADR-0003), igual que Alice, sin privilegios especiales — mantiene a
  UTA como el único punto de escritura hacia el broker.

## Decisión

`services/engine` es un proceso Node nuevo, TypeScript ESM estricto,
package `@traderalice/engine-service`, registrado en el workspace pnpm vía
el patrón ya existente `services/*` en `pnpm-workspace.yaml` (Fase 0,
[VERIFICADO EN REPOSITORIO]: la entrada ya cubre cualquier paquete nuevo
bajo `services/`, sin tocar ese archivo).

Puerto propuesto: `47340` vía `ENGINE_HTTP_PORT`. Verificado en Fase 1
contra `scripts/guardian/shared.ts` (`PORT_DEFAULTS = { web: 47331, mcp:
47332, uta: 47333, connector: 47334, ui: 5173 }`, [VERIFICADO EN
REPOSITORIO]) y contra un grep de todo el repo (`grep -rn "47340"` → sin
resultados fuera de lo que este ADR y el skeleton introducen): sin colisión.

**Fuera de alcance de esta Fase 1, explícitamente diferido:**

- Supervisión por Guardian (`scripts/guardian/prod.mjs`, `OPENALICE_ENGINE_ENABLED`)
  — es **M9** en PROMPT_MASTER §5, una modificación a `scripts/guardian/`
  que pertenece a una fase posterior, no a este ADR ni a este skeleton. Hoy
  `services/engine` arranca standalone (`pnpm -F @traderalice/engine-service dev`),
  no integrado al árbol de procesos de Guardian.
- Toda lógica de negocio (Scheduler, estrategias, RiskEngine mirror,
  ExecutionManager, etc.) — cero en esta fase, por mandato explícito.

## Consecuencias

- Un cuarto proceso bajo Guardian (eventualmente). Complejidad operativa
  adicional en despliegue (`deploy/RUNBOOK.md`, Fase 10), mitigada porque
  sigue exactamente el patrón ya operativo del Connector.
- El Engine depende de UTA por HTTP igual que Alice — ningún atajo de
  proceso compartido, ninguna importación cruzada de módulos de dominio de
  trading.
- Este ADR no decide *cómo* el Engine consulta UTA (eso es implementación
  de una fase posterior, informada por ADR-0003) ni el modelo de datos
  (ADR-0002).

## Cómo revertirla

Si se decide más adelante que el Engine debe vivir en un Harness satélite
en cambio (por ejemplo, para reutilizar más infraestructura de
investigación de AutoQuant V2): el blast radius de esta Fase 1 es un
directorio nuevo (`services/engine/`) más una entrada nueva en
`pnpm-lock.yaml`. Revertir es borrar el directorio y ejecutar `pnpm install`
para que el lockfile vuelva a su estado anterior — no hay ninguna
modificación a `src/`, `services/uta/` ni a ningún archivo compartido que
deshacer.
