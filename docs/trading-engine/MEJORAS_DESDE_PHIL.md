# Mejoras para AliceTrader a partir del repositorio Phil

**Repo analizado:** `https://github.com/bennyjo/phil` · commit `ebf14bae` (2026-09-26) · Apache-2.0
**Proyecto destino:** fork de OpenAlice (AliceTrader), estado actual: Fase 4a hecha con correcciones pendientes, Fase 4b siguiente.
**Método:** clon completo; lectura de `CYCLE.md`, `loop.sh`, `core/*.py` (ledger, resolve, score, replay, counterfactual, validate, lease, watch, real, release_calendar), `strategy/`, `journal/`, CI y `SECURITY.md`; ejecución de `core/score.py` sobre su propio journal; análisis del historial git (1.803 commits).

| Etiqueta | Significado |
|---|---|
| **[VERIFICADO EN PHIL]** | Leído en el código o calculado sobre el journal del repo, en el commit indicado |
| **[VERIFICADO EN OPENALICE]** | Leído en el código de OpenAlice (commit `0d4faa90`) |
| **[INFERENCIA]** | Conclusión desde código; no ejecutada |
| **[PROPUESTA]** | Cambio propuesto para AliceTrader |

---

## 1. Veredicto

Phil **no se integra** en Alice. Es otro activo (Polymarket), otro stack (Python) y otra filosofía: el LLM es la señal y reescribe su propia estrategia. Pero es el experimento público más honesto que he visto de "LLM que opera y aprende", y deja dos cosas valiosas:

1. **Evidencia dura** de que un LLM puede estar bien calibrado y aun así no tener ventaja sobre el mercado. Y de que, cuanto más grande es la ventaja que cree ver, peor le va. Eso confirma nuestra regla central: el LLM solo veta o reduce, nunca crea órdenes ni dimensiona.
2. **Herramientas de medición** que nos faltaban: ledger contrafactual de lo que los filtros rechazaron, evaluación re-jugable de las creencias del LLM, evidencia fechada contra el sobreajuste, auditoría independiente del ledger, y un lease con expiración para que no corran dos motores a la vez.

Resultado: **12 mejoras que adoptamos, 4 que adaptamos como opcionales y 7 cosas que rechazamos a propósito.**

---

## 2. Qué es Phil (arquitectura verificada)

| Pieza | Qué hace | Evidencia |
|---|---|---|
| `loop.sh` | Lanza `claude -p` sin supervisión cada N minutos con `CYCLE.md` como prompt; allowlist de herramientas; revierte cambios en rutas protegidas al final del ciclo; hace push | [VERIFICADO EN PHIL] `loop.sh` L159–230 |
| `CYCLE.md` | Procedimiento por ciclo: sync → lease → liquidar → puntuar → retro → editar estrategia → escanear → investigar → pronosticar → apostar → commit | [VERIFICADO EN PHIL] |
| `core/` + `config/protected.json` | Motor "protegido": ledger (único escritor), resolución oficial, scoring, topes | [VERIFICADO EN PHIL] |
| `strategy/` | Lo que el agente edita: playbook, `risk.json`, política de apuesta, filtros, cadencia | [VERIFICADO EN PHIL] |
| `journal/forecasts.jsonl` | Pronóstico de **cada** candidato investigado, apueste o no, con el libro de órdenes en ese momento | [VERIFICADO EN PHIL] `core/forecast.py`, `resolve.py` |
| `core/score.py` | Brier del agente vs el del mercado, z de suerte, calibración por tramos, barridos de umbral, blend óptimo | [VERIFICADO EN PHIL] |
| `core/replay.py` | Re-juega una política determinista (`fit/decide`) sobre creencias congeladas, en walk-forward y con forward test después de un corte | [VERIFICADO EN PHIL] |
| `core/counterfactual.py` | Ledger mecánico de los trades que los filtros rechazaron: qué costó y qué ahorró cada filtro | [VERIFICADO EN PHIL] |
| `core/validate.py` + CI | Chequeos en CI: config sana, cada fila del ledger respeta los topes, código compila | [VERIFICADO EN PHIL] |
| `core/lease.py` | Lease en `refs/phil/lease` con TTL de 50 min y compare-and-swap vía `--force-with-lease` | [VERIFICADO EN PHIL] |
| `core/watch.py` | Disparadores de eventos con topes en código, presupuesto diario y "si falla, no dispara" | [VERIFICADO EN PHIL] |
| `journal/proposals.md` / `operator-notes.md` | Canal agente→operador (con evidencia) y operador→agente | [VERIFICADO EN PHIL] |

---

## 3. Qué dicen sus propios datos

Calculado ejecutando `core/score.py` y un script propio sobre su `journal/` (commit `ebf14bae`). [VERIFICADO EN PHIL]

| Medida | Valor | Lectura |
|---|---|---|
| Apuestas liquidadas | 47 · 40 % de aciertos · PnL −$8,54 | Pierde |
| Brier en las apuestas | agente 0,296 vs mercado 0,209 (Δ +0,087) | El precio del mercado pronostica mejor |
| Suerte en las apuestas | esperaba 30,3 aciertos; tuvo 19 (z −3,98) | Sobreconfiado donde apuesta |
| Pronósticos sin apuesta | 875 · Brier Δ +0,008 · z +0,43 | **Bien calibrado, pero sin ventaja** |
| Blend óptimo (general) | w_mercado = 0,79 → mejora Brier en 0,0006 | Su estimación casi no aporta información |
| Tramo de desacuerdo (\|est − mid\| ≥ 0,05, n = 280) | Brier estimación 0,193 vs mercado 0,166 | **Donde discrepa del mercado, se equivoca más** |
| Barrido de umbral de ventaja | ROI −0,04 con ventaja ≥ 0,02 … −0,37 con ≥ 0,15 | **Cuanto más grande la ventaja que cree ver, peor le va** (selección adversa) |
| Tendencia de Brier Δ por quincena | +0,009 · +0,002 · +0,015 · +0,008 | 2 meses de auto-mejora sin tendencia de mejora |
| Apuestas por bloque | Δ +0,123 → +0,119 → +0,015 | Mejoró sobre todo apostando menos |
| Veto "outside-view" | Filas vetadas con Brier Δ +0,044 | Ese filtro sí ahorró dinero |
| Veto de spread amplio | Filas vetadas con Brier Δ −0,028 | Ese filtro puede estar costando |
| `strategy/playbook.md` | 56 → 6.770 líneas (432 KB) en 2 meses | La memoria que edita el propio LLM crece sin control |
| `strategy/risk.json` | 30 ediciones del agente | El agente cambia su política de riesgo constantemente |

**Conclusión:** el bucle de auto-mejora aprendió, sobre todo, a no apostar. La mejor señal del sistema no es el LLM, son los **filtros que lo frenan**. Y lo que permite ver eso es su instrumentación.

---

## 4. Debilidades de Phil que no debemos copiar

| # | Debilidad | Evidencia |
|---|---|---|
| W1 | Los topes se leen de `protected.json` **durante** el ciclo, y el agente tiene `Edit/Write` con `acceptEdits`. Una edición a mitad del ciclo se aplica antes de que `loop.sh` la revierta al final | [VERIFICADO EN PHIL] `loop.sh` L160–197, `core/real.py` L41–61, L187 · [INFERENCIA] sobre explotabilidad |
| W2 | La reversión solo compara el árbol de trabajo contra `HEAD`. Si el agente **commitea** el cambio en `core/`, no hay diff y no se revierte: solo imprime "review manually" y luego hace push | [VERIFICADO EN PHIL] `loop.sh` L193–217 |
| W3 | El guard de CI autoriza por el prefijo del mensaje (`operator:`). El agente tiene `git commit` permitido y puede escribir ese prefijo | [VERIFICADO EN PHIL] `.github/scripts/boundary.sh` · [INFERENCIA] bypass |
| W4 | `CLAUDE.md` dice que el CI exige `real_trading_enabled = false`; `protected.json` lo tiene en `true` | [VERIFICADO EN PHIL] |
| W5 | Dos runners (nube + local) causaron una operación duplicada el 2026-09-04 antes de que existiera el lease | [VERIFICADO EN PHIL] docstring de `core/lease.py` |
| W6 | Memoria del LLM sin presupuesto de tamaño (playbook de 432 KB releído cada ciclo) | [VERIFICADO EN PHIL] |

W1–W3 confirman nuestro diseño: la protección debe ser **preventiva** (política en solo lectura montada desde el host, auth con scopes), no una reversión a posteriori ni una convención de mensajes.

---

## 5. Decisiones

### 5.1 ADOPTAR (12)

| ID | Mejora | Por qué (evidencia) | Fase | Costo |
|---|---|---|---|---|
| **A1** | **Advisory v2 con afirmación resoluble + evaluación re-jugable.** El ContextAnalyst debe emitir una afirmación que el código pueda calificar sola: *"P(movimiento adverso ≥ k·ATR en H horas)"*. Todos los advisories se congelan en un log inmutable. Varias políticas deterministas de aplicación se re-juegan en walk-forward, y el gate usa forward test después del corte | Phil: 875 pronósticos calibrados sin ventaja; blend w=0,79. Sin afirmación resoluble no podemos medir si el advisory sirve | ADR ahora · infraestructura F6 · activación F9 | M |
| **A2** | **Ledger contrafactual de rechazos.** Cada señal bloqueada (regla de riesgo, veto del advisory, conflicto, tamaño < mínimo) genera un trade sombra con el mismo modelo de fills. Se reporta qué costó o ahorró cada filtro, con folds walk-forward | Phil: el veto outside-view ahorró (Δ +0,044); el de spread quizá costó (Δ −0,028). Sin esto no sabemos si nuestros filtros ayudan o estorban | F6 (+ campos en F5) | M |
| **A3** | **Regla anti-selección adversa.** El `score` nunca aumenta el tamaño. En backtest, la expectativa por quintil de score debe ser no decreciente (dentro del IC); si no lo es, el score no puede ordenar ni priorizar | Phil: el ROI empeora de forma monótona cuanto mayor la ventaja declarada (−0,04 → −0,37) | F3 (regla) · F6 (chequeo) | S |
| **A4** | **Evidencia fechada.** Cada versión de estrategia recibe `frozen_at`. Los gates solo cuentan decisiones posteriores a `frozen_at`. Cualquier cambio de parámetros o código = nueva versión = el contador vuelve a cero. El evaluador de gates es código y genera el informe cuando hay datos suficientes | Phil: *"the only true out-of-sample score for a policy whose thresholds were chosen by reading the ledger"* (`replay.py --after`) | F6 | S |
| **A5** | **Auditoría independiente.** Un job (diario y al arrancar UTA) re-verifica que toda operación ejecutada en TradingGit tenga su PASS en `risk-decisions.jsonl` con la política vigente, respete los topes y no ocurriera con el kill switch activo. Cualquier discrepancia → `HALT_NEW` + alerta. También en CI: validar esquema de la política de ejemplo y del estado | Phil `validate.py`: cada fila del ledger se valida contra los topes. Nos protege de bugs en el propio RiskEngine | **F4c** | S |
| **A6** | **Lease con TTL + fencing token.** El Engine obtiene de UTA un lease por cuenta con época monotónica y heartbeat. UTA rechaza escrituras del scope `engine` con época vieja, así un motor "zombi" (VPS congelado, proceso suspendido) no puede operar al volver | Phil W5: operación duplicada por dos runners. Mejora el "lock de un solo escritor" que ya estaba en backlog | F7 (endpoint en UTA + cliente) | M |
| **A7** | **Spread y fills honestos.** Guardar bid/ask/spread al decidir, al hacer commit y al fill. Nueva regla **R21 `maxSpreadBps`** por símbolo (sin bid/ask → rechazo). En paper, comprar al ask y vender al bid, más el slippage configurado | Phil: fills al ask cruzando el spread; veto de spread como filtro medido | F4c (R21) · F5 (fills) | S |
| **A8** | **Las métricas las calcula el código; el LLM cita.** Registro de métricas con ID. Los informes del PerformanceAnalyst deben citar `[m:<id>]`, y un linter de código rechaza números sin cita o que no coinciden con la BD | Phil tuvo que construir `counterfactual.py reconcile` porque las tablas a mano del agente "went stale twice" | F9 | S |
| **A9** | **Presupuestos de LLM en código, no en el prompt.** Máximo de advisories/día por productor, ejecuciones/día por rol, `timeout` por Issue, presupuesto diario de disparos y cooldown por clave | Phil: topes duros en código (lotes del screener, créditos de odds, 6 disparos/día) | F9 | S |
| **A10** | **Advisory acotado contra prompt injection.** `VETO_ALL_NEW` con duración máxima de 24 h y máximo N por 7 días; si los vetos superan X % de las señales en 30 días, se ignoran y se alerta; fuentes registradas | Phil `SECURITY.md`: la inyección vía contenido web es "the most interesting attack class". Con veto-only no puede crear trades, pero sí dejar el sistema sin operar (DoS) | ADR ahora · F9 | S |
| **A11** | **Secret scanning + push protection y rama `main` protegida en el fork**, más `gitleaks` sobre todo el historial antes del primer push. Claude Code nunca hace push a `main` | Phil lo tiene activo; nosotros ya tuvimos un incidente de credencial | **Ahora (tú)** | XS |
| **A12** | **Presupuesto de tamaño para archivos que mantiene el LLM.** Tope en KB para skills, contexto y notas de los roles; las lecciones se guardan como registros estructurados con evidencia, y la compactación la revisas tú | Phil W6: playbook de 56 → 6.770 líneas | F9 | XS |

### 5.2 ADAPTAR como opcionales (4)

| ID | Idea | Adaptación | Fase |
|---|---|---|---|
| **O1** | Calendario de publicaciones macro (`release_calendar.py`) | Regla **R22 `eventBlackouts`**: sin nuevas entradas en [−m, +n] min alrededor de eventos. El calendario vive **en la política RO** y lo mantienes tú, porque OpenAlice solo trae earnings/IPO/dividendos en su calendar board y documentos FOMC [VERIFICADO EN OPENALICE: `reference/types.ts` L60–66, `src/tool/economy.ts` L407]. CPI/NFP: NO ENCONTRADO EN EL REPOSITORIO. Lista vacía = regla inactiva | F4c (opcional) |
| **O2** | Ejecuciones disparadas por eventos (`watch.py`) | Solo para el ContextAnalyst (movimiento > X ATR), con presupuesto diario, cooldown por clave y "si falla, no dispara". El Engine no lo necesita: su monitor corre cada 10–15 s | F9 |
| **O3** | Agente de "deep retro" que audita ediciones | Auditor de las **propuestas** del PerformanceAnalyst. Prioridad baja: los datos de Phil muestran que el bucle de auto-edición no generó ventaja | F9+ |
| **O4** | `operator-notes.md` | Archivo de notas tuyas que los roles LLM leen como contexto, con tope de tamaño (A12) | F9 |

### 5.3 RECHAZAR (7)

| ID | Qué | Por qué |
|---|---|---|
| X1 | Que el LLM edite su estrategia o su política de riesgo | Phil: 30 ediciones de `risk.json` y 236 del playbook hechas por el agente, sin tendencia de mejora en Brier Δ |
| X2 | Autorizar por prefijo en el mensaje de commit | Bypass trivial (W3). Usamos montaje RO + auth con scopes |
| X3 | Reversión a posteriori como protección principal | W1/W2: el cambio ya actuó antes de revertirse |
| X4 | El LLM como fuente de señales, o dimensionar por su "ventaja" | Selección adversa medida (§3) |
| X5 | Polymarket / Pearl Connect / mechs de predicción pagados | Fuera de alcance: otro activo, otro stack, otras reglas locales |
| X6 | Topología de dos runners (nube + local) | Complejidad y duplicados (W5). Un solo VPS |
| X7 | Correr Phil ahora | Consume tu plan de Claude y compite con las sesiones que construyen AliceTrader |

---

## 6. Cambios concretos al plan

### 6.1 Nueva sub-fase F4c (después de aprobar la 4b)
- **A5** auditoría independiente (job + comando + CI).
- **A7a** regla **R21 `maxSpreadBps`**.
- **O1** regla **R22 `eventBlackouts`** (opcional; inactiva si la lista está vacía).
- Todo detrás del mismo flag del RiskEngine y con fail-closed.

### 6.2 Delta a la política de riesgo (RO)

```jsonc
{
  "accounts": {
    "<accountId>": {
      "maxSpreadBps": 15,                         // R21 — sin bid/ask → rechazo
      "eventBlackouts": [                         // R22 — opcional; [] = inactiva
        { "label": "FOMC", "at": "2026-10-28T18:00:00Z", "beforeMin": 60, "afterMin": 90 }
      ]
    }
  },
  "advisoryLimits": {                             // A10
    "vetoAllMaxTtlHours": 24,
    "vetoAllMaxPer7d": 3,
    "maxVetoCoveragePct30d": 40,
    "maxAdvisoriesPerDay": 12
  }
}
```

### 6.3 Advisory v2 (reemplaza el contrato de §9.3 del documento principal)

```json
{
  "schemaVersion": 2,
  "advisoryId": "adv_…",
  "producedBy": { "workspaceId": "…", "resumeId": "…", "issueId": "…", "model": "…" },
  "createdAt": "…", "expiresAt": "…",
  "scope": [{ "symbol": "…", "account": "…" }],
  "action": "NONE | VETO_NEW_LONGS | VETO_NEW_SHORTS | VETO_ALL_NEW | REDUCE_SIZE",
  "sizeMultiplier": 0.5,
  "claim": {
    "type": "ADVERSE_MOVE",
    "symbol": "…",
    "direction": "DOWN | UP",
    "thresholdAtr": 1.5,
    "horizonHours": 12,
    "probability": 0.35
  },
  "reasonCodes": ["…"],
  "evidence": [{ "type": "news", "ref": "…", "summary": "…" }],
  "counterEvidence": [{ "type": "…", "ref": "…", "summary": "…" }]
}
```
- `claim` se resuelve mecánicamente con barras cerradas: ¿el precio se movió ≥ `thresholdAtr` × ATR en `direction` dentro de `horizonHours`?
- **Línea base** (no existe un "precio de mercado" de esa probabilidad): la frecuencia climatológica del mismo evento en el histórico del símbolo, calculada por código.
- Métricas: Brier del claim vs la línea base, calibración por tramos, z de suerte, blend óptimo y tramo de desacuerdo.
- **Gate de activación (pre-registrado):** n ≥ 200 claims resueltos después de `frozen_at`; Brier mejor que la línea base con IC bootstrap que no cruce 0; y la mejor política de aplicación re-jugada en walk-forward reduce el drawdown o mejora la expectativa con IC que no cruce 0, **confirmada en forward test**. Si no pasa, el advisory se queda en sombra indefinidamente.

### 6.4 Delta de esquema SQLite (Engine)

```sql
ALTER TABLE decisions ADD COLUMN bid TEXT;
ALTER TABLE decisions ADD COLUMN ask TEXT;
ALTER TABLE decisions ADD COLUMN spread_bps REAL;
ALTER TABLE fills ADD COLUMN bid_at_fill TEXT;
ALTER TABLE fills ADD COLUMN ask_at_fill TEXT;
ALTER TABLE strategies ADD COLUMN frozen_at TEXT;          -- A4

ALTER TABLE llm_advisories ADD COLUMN claim_json TEXT;      -- A1
ALTER TABLE llm_advisories ADD COLUMN claim_resolved_at TEXT;
ALTER TABLE llm_advisories ADD COLUMN claim_outcome INTEGER;   -- 0/1; NULL = abierto
ALTER TABLE llm_advisories ADD COLUMN baseline_prob REAL;

CREATE TABLE counterfactual_trades (                        -- A2
  cf_id TEXT PRIMARY KEY, decision_id TEXT REFERENCES decisions,
  source TEXT NOT NULL CHECK (source IN ('risk_reject','advisory_veto','advisory_reduce',
                                          'conflict','size_below_min','near_miss')),
  rule_or_reason TEXT NOT NULL, side TEXT, entry_price TEXT, stop_price TEXT, target_price TEXT,
  sim_fill_json TEXT, outcome TEXT, net_pnl TEXT, r_multiple REAL,
  resolved_at TEXT, fold INTEGER, created_at TEXT NOT NULL);

CREATE TABLE metric_snapshots (                             -- A8
  metric_id TEXT PRIMARY KEY, name TEXT NOT NULL, params_json TEXT NOT NULL,
  value_json TEXT NOT NULL, query_hash TEXT NOT NULL, computed_at TEXT NOT NULL);

CREATE TABLE llm_budget_usage (                             -- A9
  day TEXT NOT NULL, role TEXT NOT NULL, runs INTEGER NOT NULL DEFAULT 0,
  advisories INTEGER NOT NULL DEFAULT 0, triggers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, role));

CREATE TABLE audit_runs (                                   -- A5 (espejo; la autoridad es UTA)
  audit_id TEXT PRIMARY KEY, at TEXT NOT NULL, scope TEXT NOT NULL,
  ok INTEGER NOT NULL, findings_json TEXT, action_taken TEXT);
```
Del lado UTA (archivos): `data/trading/_risk/engine-lease.json` (A6: época, holder, expiresAt) y `data/trading/_risk/audit.jsonl` (A5).

### 6.5 Lease + fencing (A6)
- `POST /api/trading/risk/engine-lease` (scope `engine`) `{accountId, instanceId, ttlSec}` → `{epoch, expiresAt}`; renovación por heartbeat; lease vencido → otro puede tomarlo con `epoch + 1`.
- Toda escritura del scope `engine` envía `X-Engine-Epoch`. UTA rechaza con **409** si no coincide con la época vigente.
- La época se persiste de forma atómica. Si el estado es ilegible → nadie tiene lease → `HALT_NEW` para el scope `engine`.

### 6.6 Nuevos ADRs
- **ADR-0007** Advisory v2: claim resoluble, límites contra inyección y gate de activación.
- **ADR-0008** Evidencia fechada (`frozen_at`) y ledger contrafactual.
- **ADR-0009** Lease con fencing Engine↔UTA.
- **ADR-0010** Auditoría independiente del ledger contra la política.

---

## 7. Acceptance tests por mejora

| ID | Test obligatorio |
|---|---|
| A1 | Un claim sintético se resuelve de forma idéntica dos veces; con datos futuros ausentes queda abierto; la línea base climatológica es reproducible; el replay de una política trivial (no aplicar nunca) da exactamente el resultado sin advisory |
| A2 | Toda señal bloqueada produce una fila contrafactual; su fill usa el mismo modelo que paper; los folds cubren el periodo sin solaparse |
| A3 | En un dataset sintético donde el score predice al revés, el chequeo de monotonía falla y el score queda marcado como no usable para ordenar |
| A4 | Cambiar un parámetro crea una nueva versión con `frozen_at` nuevo y los gates cuentan cero trades para ella |
| A5 | Inyectar en un fixture una operación ejecutada sin PASS en `risk-decisions.jsonl` → la auditoría falla, pasa a `HALT_NEW` y alerta. Un ledger limpio pasa |
| A6 | Dos instancias: la segunda no obtiene el lease; tras vencer el TTL, la segunda toma la época +1 y las escrituras de la primera reciben 409 |
| A7 | Sin bid/ask → rechazo R21; spread por encima del límite → rechazo; en paper, compra al ask y venta al bid más slippage |
| A8 | Un informe con un número sin cita o que no coincide con la BD es rechazado por el linter |
| A9 | Advisory N+1 del día → 429 y registro en `llm_budget_usage` |
| A10 | Un `VETO_ALL_NEW` con TTL > 24 h se recorta; el 4.º en 7 días se ignora y alerta; la cobertura > X % en 30 días alerta |
| A11 | (Tú) Push de un archivo con un secreto de prueba → bloqueado por GitHub |
| A12 | Un archivo de rol por encima del tope en KB hace fallar el chequeo |
| O1 | Con `eventBlackouts` vacío la regla no actúa; dentro de la ventana, rechazo R22 |

---

## 8. Prompt para Claude Code

Está en `PROMPT_MEJORAS_PHIL.md`. **Sustituye** al prompt corto de 4 ideas que te di antes: si ya lo pegaste, este lo reemplaza.

---

## 9. Lo que te toca a ti (fuera de Claude Code)

1. **Antes del primer push al fork** (A11): en GitHub → Settings → *Code security* activa **Secret scanning** y **Push protection**. En *Branches*, protege `main` (PR obligatorio, sin force-push).
2. **Si activas O1:** mantener la lista de eventos (FOMC, CPI, NFP) en la política de riesgo del host. Las fechas se publican con meses de antelación.
3. **Decidir el gate del advisory (A1):** los números de §6.3 son iniciales. Se fijan en el ADR-0007 **antes** de ver datos, y no se cambian después.

Fuentes: [bennyjo/phil](https://github.com/bennyjo/phil) · [TraderAlice/OpenAlice](https://github.com/TraderAlice/OpenAlice)
