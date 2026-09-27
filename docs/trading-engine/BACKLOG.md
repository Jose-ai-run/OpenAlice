# Backlog — mejoras derivadas del análisis de Phil

**[DOCUMENTACIÓN]** Este backlog registra el resultado de analizar
`bennyjo/phil` (commit `ebf14bae`) — un bucle de Claude Code que opera
en papel sobre Polymarket y reescribe su propia estrategia. **No lo
integramos.** Sus propios datos muestran que el LLM está calibrado pero
no le gana al mercado, y que cuanto mayor la ventaja que cree ver, peor
le va — el hallazgo que motiva por qué toda mejora que le daría al LLM
más autoridad de decisión queda rechazada o congelada, y solo se
adoptan mejoras de medición y seguridad del núcleo determinístico.

Origen: `docs/trading-engine/MEJORAS_DESDE_PHIL.md` (referencia externa,
sin modificar). **Nota:** ese archivo no se pudo copiar en esta ronda —
no se encontró en `C:\AliceTrader\MEJORAS_DESDE_PHIL.md` ni en ninguna
ruta accesible. El registro de abajo se construyó directamente a partir
de la especificación inline que el usuario proporcionó en el prompt de
aprobación de la Fase 4b (2026-09-27), que es completa y autocontenida
para cada ID. Pendiente: el usuario confirma la ruta correcta del
archivo o lo adjunta de nuevo para completar la copia literal.

Donde este backlog difiera en alcance de `MEJORAS_DESDE_PHIL.md` (una
vez copiado), **manda el prompt de aprobación de la Fase 4b**, no el
documento de Phil — así lo estableció el usuario explícitamente.

## Cómo leer esta tabla

- **Estado:** `activa` (aprobada para implementar en su fase) ·
  `congelada` (registrada, NO implementar hasta aprobar Fase 8) ·
  `opcional` (solo backlog, sin fase asignada) · `rechazada`
  (registrada para que nadie la reintroduzca).
- **Fase:** dónde se implementa (o "F8+" para las congeladas, ninguna
  para las rechazadas).
- Un ADR está listado cuando el ítem tiene diseño propio; los demás se
  implementan directamente contra el criterio de aceptación de esta
  tabla, sin ADR dedicado.

## Activas

| ID | Descripción | Fase | Criterio de aceptación | ADR |
|---|---|---|---|---|
| A2 | Ledger contrafactual: toda señal bloqueada (`risk_reject`, `advisory_veto`, `advisory_reduce`, `conflict`, `size_below_min`, `near_miss`) genera un trade sombra con el mismo modelo de fills que paper, resuelto con barras cerradas (stop/target/time-stop originales); informe por fuente y regla con n, PnL, R, expectativa y folds walk-forward. | F6 (campos preparados desde F5) | Toda señal bloqueada produce su fila contrafactual con el mismo modelo de fills que paper, y los folds walk-forward no se solapan. | [[docs/adr/0008-dated-evidence-counterfactual-ledger.md]] |
| A3 | El score nunca dimensiona ni prioriza: expectativa por quintil de score debe ser no-decreciente dentro del IC 95%. Si no lo es, la estrategia se marca `score_not_monotonic` y el score queda inhabilitado para ordenar/priorizar. | Regla en F3, chequeo automatizado en F6 | Un dataset sintético con score invertido (peor score → mejor resultado) falla el chequeo y marca la estrategia `score_not_monotonic`. | — |
| A4 | Evidencia fechada: `frozen_at` por versión de estrategia al entrar en PAPER; cualquier cambio de parámetros o código crea una nueva versión con el contador de evidencia en cero; los gates de promoción solo cuentan decisiones posteriores a `frozen_at`; el evaluador de gates es código (determinista), no juicio humano ad hoc, y solo emite informe cuando hay datos suficientes. | F6 | Cambiar un parámetro crea una versión nueva de la estrategia con el contador de evidencia en cero. | [[docs/adr/0008-dated-evidence-counterfactual-ledger.md]] |
| A5 | Auditoría independiente: job en UTA (al arrancar y diario) que verifica que cada operación ejecutada en TradingGit tenga su PASS correspondiente en `risk-decisions.jsonl`, que respete los topes de la política vigente en ese momento (por `policyHash`), y que no haya ocurrido con el kill switch en `HALT_NEW` o `FLATTEN`. Cualquier discrepancia → `HALT_NEW` + alerta + entrada en `data/trading/_risk/audit.jsonl`. En CI: valida el esquema de la política de ejemplo y del estado de riesgo. | **F4c — implementado 2026-09-27** | Una operación ejecutada sin su PASS correspondiente hace fallar la auditoría, fuerza `HALT_NEW` y queda registrada; un ledger consistente pasa sin alertar. | [[docs/adr/0010-independent-audit.md]] |
| A6 | Lease + fencing para el Engine: `POST /api/trading/risk/engine-lease` (scope `engine`) `{accountId, instanceId, ttlSec}` → `{epoch, expiresAt}`; heartbeat periódico; al vencer el TTL, otra instancia toma `epoch+1`; toda escritura de scope `engine` debe enviar `X-Engine-Epoch`, UTA responde 409 si no coincide con la época vigente; la época se persiste de forma atómica en `data/trading/_risk/engine-lease.json`; si ese estado es ilegible → `HALT_NEW` para el scope `engine` específicamente. | F7 | Una segunda instancia del Engine no obtiene el lease mientras la primera lo sostiene; al expirar el TTL la segunda toma `epoch+1` y la primera recibe 409 en su siguiente escritura. | [[docs/adr/0009-engine-lease-fencing.md]] |
| A7a | Regla R21 `maxSpreadBps` por cuenta/símbolo en la política RO: `spreadBps = (ask − bid)/mid × 10.000`; sin `bid`/`ask` disponible → rechazo. Requiere verificar primero qué expone `Quote` hoy y qué entrega cada broker pack (si alguno no da bid/ask, documentarlo explícitamente antes de escribir la regla). | **F4c — implementado 2026-09-27** | Sin bid/ask disponible, R21 rechaza; con spread por encima del límite configurado, R21 rechaza. | [[docs/adr/0010-independent-audit.md]] (comparte fase F4c; sin ADR propio — es una regla R* más, mismo patrón que R0–R20). Hallazgo real de la verificación previa: `LeverupBroker` no da bid/ask real (`bid=ask=last`) — R21 no lo protege, documentado en `docs/risk-engine.md`, no oculto. |
| A7b | Fills honestos en paper: comprar al ask, vender al bid, más slippage. Extiende M10 de forma retrocompatible si el simulador de paper no admite bid/ask todavía. Se guarda bid/ask/spread al decidir, al hacer commit y al llenarse. | F5 | En paper, una compra se ejecuta al ask y una venta al bid, con slippage aplicado encima. | — |
| A11 | Secretos: el usuario activa secret scanning, push protection y protección de la rama `main` en GitHub. El agente corre `gitleaks` (o equivalente) sobre **todo el historial de todas las ramas** antes del primer push al fork, y reporta hallazgos sin mostrar valores de credenciales — nunca push directo a `main`. | Antes del primer push al fork | `gitleaks` (o equivalente) corre sobre el historial completo y el reporte no contiene ningún valor de credencial, solo su forma y origen. | — |
| S1 | Cerrar el camino agente → Alice → UTA: las rutas de escritura del proxy de Alice exigen sesión autenticada + CSRF incluso desde loopback; en UTA, las cuentas del Engine (marcadas en la política RO) solo aceptan `stage`/`commit` con scope `engine` y `push` en modo `HUMAN_APPROVAL` (solo el `pendingHash` que el propio Engine creó). | F4d (Fase 4d de este mandato) | Desde loopback sin sesión: push/place-order/stage/config de agente → 401. Con sesión válida, la UI aprueba. Telegram sigue aprobando por su vía real. Una cuenta del Engine rechaza staging con el token de Alice (que no lleva scope `engine`). | — (se diseña dentro de la propia Fase 4d si hace falta; no listado en el pedido de ADRs de esta ronda) |

## Congeladas (registrar, NO implementar hasta aprobar Fase 8)

Todas dependen de darle a la capa LLM más autoridad de decisión sobre
señales, tamaño o parámetros — exactamente lo que el análisis de Phil
muestra que degrada el resultado cuanto más "convencido" está el
modelo. Se registran para no perder el diseño, no para bloquear su
eventual revisión en F8.

| ID | Descripción | Motivo de la congelación |
|---|---|---|
| A1 | Advisory v2 (el LLM asesora sobre señales ya generadas por el núcleo determinístico, con más contexto/formato). | Amplía la superficie de influencia del LLM sobre decisiones de trading antes de tener evidencia (vía A2/A4) de que el advisory actual no perjudica el resultado. |
| A8 | Métricas con ID + linter de informes generados por el LLM. | Depende de A1/A9 — no tiene sentido sin la capa advisory que audita. |
| A9 | Presupuestos de LLM fijados en código (tokens/costo/latencia por ciclo). | Es una mejora de control de costos de la capa LLM, no del núcleo determinístico — mismo criterio de congelación que el resto de la capa advisory. |
| A10 | Límites del advisory contra prompt injection (contenido externo que el LLM lee no debe poder alterar su propio comportamiento). | Depende de que A1 exista primero; es defensa de una superficie que hoy no está activa. |
| A12 | Tope de tamaño de archivos que el LLM puede leer/escribir. | Mismo criterio — control de la capa LLM, no del núcleo. |
| O2 | Disparos de advisory por eventos (en vez de por temporizador). | Depende de A1. |
| O3 | Auditor de propuestas del LLM (una segunda pasada que revisa lo que el LLM propuso antes de aplicarlo). | Depende de A1; además roza X3 (revertir a posteriori) si no se diseña con cuidado — requiere su propio ADR cuando se aborde. |
| O4 | `operator-notes` — notas del operador humano visibles para el LLM advisory. | Depende de A1. |

## Opcional (solo backlog, sin fase asignada)

| ID | Descripción | Motivo |
|---|---|---|
| O1 | Regla R22 `eventBlackouts` (bloquear trading alrededor de eventos calendarizados: FOMC, NFP, etc.). | Buena idea, sin dependencia de la capa LLM ni de las congeladas — pero no priorizada aún. Puede entrar directo a F4c junto a R21 el día que se decida, sin esperar a F8. |

## Rechazadas (para que nadie las reintroduzca)

| ID | Descripción | Por qué se rechaza |
|---|---|---|
| X1 | Un LLM que edita la estrategia o los límites de riesgo directamente. | Regla explícita del mandato: ningún cambio permite que un LLM cree órdenes, dimensione posiciones o modifique límites. Es exactamente lo que Phil hace y exactamente lo que sus propios datos muestran que no funciona. |
| X2 | Autorizar operaciones por prefijo de mensaje de commit (una convención de texto como control de acceso). | Un control de acceso nunca puede ser una convención de formato de texto — es trivialmente falsificable por cualquier proceso que pueda escribir un commit. |
| X3 | Reversión a posteriori como mecanismo de protección (dejar que algo se ejecute y deshacerlo si luego se detecta que estaba mal). | La protección siempre debe ser preventiva (montaje RO, auth con scopes, sesión, fencing) — una reversión a posteriori ya permitió el daño real (una orden de mercado ejecutada no se deshace por reescribir el estado). |
| X4 | El LLM como fuente de señales de entrada o de sizing. | Mismo hallazgo de Phil: calibrado pero sin edge real, y peor cuanto más convencido. El núcleo determinístico (R0–R20, las estrategias de `services/engine/src/strategies/`) es la única fuente de señales y sizing. |
| X5 | Integración con Polymarket, Pearl, o los "mechs" del stack de Phil. | Fuera de alcance del producto — OpenAlice no opera en mercados de predicción, y esta integración es específica del dominio de Phil. |
| X6 | Dos runners corriendo en paralelo (redundancia activa-activa al estilo de Phil). | No resuelve ningún problema real identificado en este repositorio; A6 (lease + fencing) ya cubre el caso legítimo de "una segunda instancia del Engine no debe pisar a la primera" sin necesitar dos runners activos simultáneos. |
| X7 | Ejecutar Phil directamente (clonarlo y correr `loop.sh` u otro disparador hacia Claude/Polymarket/Pearl). | Instrucción explícita del usuario: no clonar salvo para verificar, nunca ejecutar `loop.sh` ni nada que llame a Claude, Polymarket o Pearl. |

## Deltas de esquema (SQLite, migraciones nuevas — nunca editar migraciones ya aplicadas)

Registrados aquí para que la fase que corresponda (F5/F6/F7, ver tabla
de activas) los aplique como migraciones **nuevas**, nunca como edición
de una migración ya aplicada. Ninguna tabla ni columna de las mejoras
congeladas se crea todavía.

- `decisions`: + `bid`, `ask`, `spread_bps`
- `fills`: + `bid_at_fill`, `ask_at_fill`
- `strategies`: + `frozen_at`
- `counterfactual_trades(cf_id PK, decision_id FK, source CHECK IN ('risk_reject','advisory_veto','advisory_reduce','conflict','size_below_min','near_miss'), rule_or_reason, side, entry_price, stop_price, target_price, sim_fill_json, outcome, net_pnl, r_multiple, resolved_at, fold, created_at)`
- `audit_runs(audit_id PK, at, scope, ok, findings_json, action_taken)`
