# ADR-0006: Tools de lectura del Engine — skill vs `src/tool/`

**Estado:** Aceptado (decisión de diseño); implementación diferida a una fase posterior
**Fecha:** 2026-09-24
**Fase:** F1 (Architecture)

## Contexto

PROMPT_MASTER §12 pide, textual: "No añadas tools de trading que ejecuten
órdenes. Solo lectura del Engine: `engineStatus`, `engineWhy(symbol, at)`,
`engineMetrics(strategyId)`, expuestas vía skill que llama a la API del
Engine, **o** como tools en `src/tool/` que solo leen (sin un motor en
`src/`). Documenta la elección en un ADR."

Evidencia de Fase 0 relevante para esta decisión:

- `AGENTS.md` (leído en Fase 0, [DOCUMENTACIÓN]): "New agent-facing
  capabilities normally ship as Workspace templates, skills, or satellite
  repositories. Do not grow a parallel workflow engine in `src/`." — la
  misma regla que motivó ADR-0001 aplica aquí, aunque de forma más matizada:
  el motor de lectura no viviría en `src/`, pero **el punto de acceso del
  agente** sí podría, si se eligiera la Opción B.
- El repo ya tiene un patrón establecido de exactamente este tipo:
  `default/skills/alice-uta/` y `default/skills/traderhub/`
  ([VERIFICADO EN REPOSITORIO], `ls default/skills/` en Fase 1 lista:
  `alice, alice-analysis, alice-uta, build-thesis, delegate-autoquant,
  file-delivery, market-data, opencli-reader, retrospective,
  scan-value-chain, sector-rotation, self-scheduling, traderhub,
  workspace-manager`). Ambos enseñan al agente a invocar un CLI/API
  externo (`alice-uta`, `traderhub`) en vez de exponer tools nativas en
  `src/tool/` para ese dominio — es el precedente directo más cercano a
  "Engine" como dominio nuevo.
- `src/tool/trading.ts` (932 líneas, Fase 0) es el ejemplo de tools nativas
  en `src/tool/` para un dominio — pero ese dominio (UTA) vive
  arquitectónicamente adyacente a Alice desde el principio (UTA es un
  proceso hermano supervisado por el mismo Guardian que Alice, con un
  cliente ya definido en `packages/uta-protocol`). El Engine, según
  ADR-0001, es un proceso nuevo sin ese mismo grado de integración previa.

## Opciones consideradas

### Opción A — Skill que llama a la API HTTP del Engine — **elegida**

Una skill nueva (`default/skills/trading-desk-context/` u similar, ya
prevista en PROMPT_MASTER §7 como
`default/skills/trading-desk-context/SKILL.md`) enseña a los roles LLM
(ContextAnalyst, TradeReviewer, PerformanceAnalyst — PROMPT_MASTER §11) a
llamar directamente a `GET /engine/status`, `GET /engine/why`,
`GET /engine/metrics/:strategyId` (los mismos endpoints de solo lectura
que PROMPT_MASTER §20 ya especifica para el Engine), igual que
`alice-uta`/`traderhub` enseñan a llamar a sus respectivos CLIs/APIs.

- **Ventajas:**
  - Cero cambios a `src/` — ni siquiera tools de solo lectura. Coherente al
    máximo con "Do not grow a parallel workflow engine in `src/`" y con el
    mandato explícito de esta Fase 1 de no tocar `src/`.
  - Sigue el patrón ya validado y en producción del repo (`alice-uta`,
    `traderhub`) en vez de introducir un patrón nuevo.
  - El Engine puede evolucionar su API (`/engine/status`, `/engine/why`,
    etc. — PROMPT_MASTER §20) sin coordinar un cambio simultáneo en
    `src/tool/`; la skill referencia la API por contrato HTTP, no por
    import de tipos compartidos.
  - Los roles LLM (§11) ya están diseñados como "skills + Issues
    programados", no como tools nativas — una skill de lectura del Engine
    encaja exactamente en ese mismo mecanismo, sin inventar uno nuevo para
    un solo caso.
- **Desventajas:**
  - Un agente interactivo normal (no uno de los tres roles LLM
    específicos) no tiene la tool nativa "a mano" en su lista de tools de
    Alice — necesita conocer/cargar la skill primero. Mitigado porque
    PROMPT_MASTER §12 ya dice "Reutiliza las tools existentes de mercado y
    análisis para los roles LLM" — la skill del Engine se suma a esa
    familia de skills de dominio, no reemplaza las tools generales de
    Alice.

### Opción B — Tools de solo lectura en `src/tool/` (p. ej. `src/tool/engine.ts`)

- Descartada, pero no por prohibición absoluta (PROMPT_MASTER la deja como
  alternativa válida) sino por consistencia arquitectónica:
  - Requeriría tocar `src/` — cada tool nueva necesita registrarse en
    `src/core/tool-center.ts` (Fase 0, [VERIFICADO EN REPOSITORIO]) —,
    trabajo que además el mandato de Fase 1 prohíbe explícitamente hacer
    ahora.
  - `src/tool/trading.ts` ya es el ejemplo de "tools nativas para un
    dominio de trading" — pero ese dominio (UTA) está desde el diseño
    original acoplado a Alice a través de `src/services/uta-client/`
    (Fase 0, [VERIFICADO EN REPOSITORIO], `docs/project-structure.md`
    "Alice and UTA Boundary"). El Engine, en cambio, es explícitamente un
    proceso nuevo y separado (ADR-0001) sin ese acoplamiento previo — no
    hay una razón histórica para replicar el mismo patrón.
  - Cada tool nueva en `src/tool/` es superficie que crece en un archivo ya
    grande (932 líneas en `trading.ts`) y que requiere mantenerse
    sincronizada con la API del Engine a mano.

## Decisión

**Opción A.** Las tools de lectura del Engine (`engineStatus`,
`engineWhy(symbol, at)`, `engineMetrics(strategyId)`) se exponen vía una
skill nueva que llama a la API HTTP `/engine/*` del Engine — no como tools
nativas en `src/tool/`. Ningún motor ni cliente del Engine vive en `src/`.

**Fuera de alcance de esta Fase 1:** escribir la skill en sí
(`default/skills/trading-desk-context/SKILL.md`) y los endpoints
`/engine/status`, `/engine/why`, `/engine/metrics/:strategyId` que
consumiría — ninguno de los dos existe todavía; esta Fase 1 solo
implementó `GET /engine/health` (ver `services/engine/src/http/routes-health.ts`).
Esos endpoints reales llegan cuando exista Scheduler + DecisionJournal +
RiskEngine mirror que produzcan datos que leer (Fases 3+).

## Consecuencias

- El Engine mantiene su API HTTP como el único contrato público —
  cualquier cliente (skill, Alice, un humano con `curl`) lo consume igual.
  No hay un segundo contrato (tipos de tool compartidos) que mantener en
  paralelo.
- Si en el futuro se decide que un agente interactivo genérico (no un rol
  LLM del trading-desk) necesita consultar el Engine con más fricción
  cero, este ADR se puede reabrir para añadir tools nativas de solo
  lectura en `src/tool/` — la API HTTP ya existente sería la base de esa
  implementación futura, no un cambio incompatible.

## Cómo revertirla

Añadir tools de solo lectura en `src/tool/engine.ts` que llamen a la misma
API HTTP del Engine (Opción B) es aditivo, no destructivo — no requiere
deshacer la skill, ambas podrían coexistir. Revertir del todo (quitar la
skill) es borrar `default/skills/trading-desk-context/` sin ningún efecto
sobre el Engine mismo, que sigue exponiendo su API HTTP igual.
