# ADR-0009: Lease + fencing para escrituras del Engine (A6)

**Estado:** Propuesto — diseño únicamente, **cero implementación en esta ronda**
**Fecha:** 2026-09-27
**Fase:** F7

## Contexto

Este ADR registra el diseño de la mejora A6 del análisis de
`bennyjo/phil` (`docs/trading-engine/BACKLOG.md`), adaptada al modelo de
auth de scopes que ya existe en este repositorio (ADR-0003,
`services/uta/src/http/auth.ts`, [VERIFICADO EN REPOSITORIO] — Fase 4b).

**El problema que resuelve, en términos concretos de este repo:** una
vez que el Engine (F7+) escriba directamente contra UTA con un token de
scope `engine` (lectura + `stage`, nunca `approve`/`operator` —
ADR-0003), nada impide hoy que **dos procesos del Engine** terminen
corriendo a la vez para la misma cuenta — un despliegue que no mató al
proceso viejo antes de levantar el nuevo, un reinicio manual duplicado,
un proceso "zombi" que quedó colgado tras un crash parcial. Ambos
tendrían el mismo token válido y ambos podrían `stage`/`commit` sobre el
mismo `TradingGit` (`services/uta/src/domain/trading/git/TradingGit.ts`,
[VERIFICADO EN REPOSITORIO]) de forma concurrente, con el riesgo real de
staging cruzado o de decisiones basadas en un estado de mercado que el
otro proceso ya invalidó.

Este es el problema clásico de "escritor zombi" en sistemas
distribuidos — el token de sesión (aquí, el bearer token de scope
`engine`) prueba *identidad*, no *vigencia*: un proceso puede seguir
siendo el legítimo dueño del token mucho después de haber dejado de ser
la instancia autoritativa. La solución estándar es un **fencing token**
monótonamente creciente (aquí, `epoch`) que el recurso protegido (UTA)
compara en cada escritura, no solo al inicio de la sesión.

**Precedentes reales ya en el repo que este diseño reutiliza en vez de
inventar mecanismo nuevo:**
- `services/uta/src/domain/trading/risk/risk-state.ts` —
  escritura atómica tmp+rename por cuenta, con reintento acotado ante
  `EPERM`/`EBUSY` transitorios de Windows (hallazgo real de Fase 4a).
  El estado de lease usa exactamente el mismo mecanismo.
- `services/uta/src/domain/trading/risk/deployment-safety.ts` /
  `http/auth.ts` (Fase 4b) — el patrón "estado ilegible → fail-closed,
  nunca fail-open" que este ADR extiende al estado del lease.
- ADR-0004 ya anticipó `routes-risk.ts` como el lugar para "endpoints
  administrativos nuevos" — todavía no existe
  (`services/uta/src/http/` solo tiene `routes-trading.ts` y
  `routes-simulator.ts`, [VERIFICADO EN REPOSITORIO]); este ADR es el
  primero en darle contenido real.

## Opciones consideradas

### Opción A — Un solo proceso del Engine permitido, exclusión por PID/lockfile de sistema operativo

- Descartada. Un lockfile de SO no sobrevive a un despliegue
  multi-host ni a un contenedor reiniciado con un PID distinto — no
  resuelve el caso real (dos procesos en dos hosts, o un contenedor
  viejo que Kubernetes tardó en matar). Además, UTA es quien debe
  decidir qué escritura acepta, no el propio Engine confiando en su
  vecino.

### Opción B — Reventar el token del Engine anterior al arrancar uno nuevo (revocación en vez de fencing)

- Descartada. Requeriría que UTA sepa "cuál es *el* Engine" de forma
  singular y reescriba `OPENALICE_UTA_TOKENS_FILE` en caliente — pero
  ese archivo es explícitamente de solo escritura por el operador del
  host (Fase 4b, corrección A.1: "quien pueda escribirlo puede darse
  scope operator al instante"). Darle a UTA la capacidad de reescribirlo
  reintroduce exactamente el riesgo que esa corrección cerró.

### Opción C — Fencing token (epoch) por cuenta, verificado en cada escritura de scope `engine` — **elegida**

## Decisión (diseño, no implementación)

**Recurso fenced:** la autoridad de escritura del Engine **por cuenta**,
no global — el cuerpo de la petición de lease incluye `accountId`
precisamente porque dos Engines legítimos pueden coexistir si operan
sobre cuentas distintas.

**Endpoint:** `POST /api/trading/risk/engine-lease` (scope `engine`,
`services/uta/src/http/routes-risk.ts`, nuevo archivo — F7):

```
Request:  { accountId: string, instanceId: string, ttlSec: number, release?: true }
Response: { epoch: number, expiresAt: string }
```

Semántica de la petición:
1. Sin lease previo, o lease previo con `expiresAt` ya pasado (según el
   reloj de UTA, nunca uno enviado por el cliente — ver más abajo) →
   conceder: **`epoch = max(epochAnterior + 1, Date.now())`** (no
   simplemente `epochAnterior + 1` — ver "Enmienda 1" abajo, la razón
   de este cambio), `expiresAt = now + ttlSec`, persistir, responder
   `{epoch, expiresAt}`.
2. Lease vigente sostenido por el **mismo** `instanceId` (heartbeat) →
   renovar `expiresAt`, **mismo** `epoch` (una renovación no es un
   cambio de autoridad).
3. Lease vigente sostenido por **otro** `instanceId` → rechazar
   **409 con la identidad del holder actual**:
   `{ error: 'LEASE_HELD', holder: { instanceId, expiresAt } }` — el
   llamante puede así decidir con información (esperar, o rendirse) en
   vez de reintentar a ciegas.
4. `release: true` de parte del `instanceId` que sostiene el lease
   vigente → libera inmediatamente (`expiresAt = now`, sin tocar el
   `epoch` — la monotonicidad no depende de cuándo se libera, ver
   Enmienda 1) — ver "Liberación explícita" abajo.

**Persistencia:** `data/trading/<accountId>/_risk/engine-lease.json`
— mismo directorio `_risk/` que `risk-state.json`, mismo mecanismo
atómico tmp+rename con reintento acotado ante `EPERM`/`EBUSY`
(`risk-state.ts` es el precedente literal a reutilizar, no reinventar).
Forma: `{ accountId, instanceId, epoch, expiresAt, updatedAt }`.

### Enmienda 1 (2026-09-27, antes de implementar en F7) — época monotónica aunque se pierda el estado

**Problema que el diseño original no cerraba:** `epoch = epochAnterior
+ 1` asume que `engine-lease.json` es la única fuente de verdad sobre
qué época ya se emitió. Si ese archivo se pierde — borrado a mano,
corrupción del volumen, una migración de `OPENALICE_HOME` que no
arrastró `data/trading/<id>/_risk/`, o un atacante que específicamente
lo borra para resetear el contador — la siguiente concesión volvería a
`epoch = 1`. Un motor zombi que todavía tiene en memoria un
`X-Engine-Epoch` viejo (pongamos, `epoch = 5`, de antes de que el
archivo se perdiera) **seguiría siendo rechazado** (5 ≠ 1) — pero un
zombi que además fue el ÚLTIMO en escribir con éxito antes de la
pérdida, y que por azar reintenta *después* de que otra instancia ya
tomó `epoch = 1`, podría coincidir si ambos números pequeños se
superponen en el futuro. Más importante aún: perder el archivo no debe
ser una forma de "empezar de cero" un contador de seguridad — un
archivo de fencing que se puede resetear borrándolo no es fencing.

**Decisión:** la época concedida en el punto 1 de arriba es
**`max(epochAnterior + 1, Date.now())`**, no simplemente
`epochAnterior + 1`. Milisegundos de reloj de pared solo avanzan con el
tiempo real — incluso si `engine-lease.json` se pierde por completo
(tratado como `epochAnterior = 0`), la época concedida es
`Date.now()` en ese instante, un número astronómicamente mayor que
cualquier época pequeña y secuencial que un zombi pudiera repetir por
azar. Esto cierra el caso sin necesitar detectar "¿este archivo existió
antes?" (lo cual requeriría un segundo registro que nunca se borra,
más complejidad para un beneficio que el esquema por tiempo ya cubre).
**Caveat explícito, no oculto:** esto asume que el reloj de UTA no
retrocede de forma significativa (ajuste de NTP hacia atrás, cambio
manual de hora) — un supuesto razonable para un proceso de servicio
interno, pero no una garantía criptográfica; se documenta aquí para que
quien implemente F7 no lo trate como una prueba absoluta.

### Enmienda 2 — heartbeat y reloj

El heartbeat (renovación, punto 2 de la semántica) debe enviarse **a
menos de `ttlSec / 3`** desde la última concesión/renovación — no "en
algún momento antes de que expire": un margen de seguridad de 3× evita
que latencia de red o un GC pause hagan perder el lease por un
heartbeat que llegó tarde por poco. **`expiresAt` se evalúa siempre con
el reloj propio de UTA** (el mismo `now()` inyectable que
`RiskEngineDeps` ya usa en `risk-engine.ts`, [VERIFICADO EN
REPOSITORIO] — mismo patrón de inyección para tests herméticos) —
nunca con un timestamp que el cliente envíe en el cuerpo de la
petición; de lo contrario, un Engine con el reloj desincronizado (o uno
malicioso) podría declarar su propio lease "todavía vigente" cuando UTA
ya lo considera expirado.

**Fencing en cada escritura:** toda petición cuyo token autenticado
lleve el scope `engine` (no "toda ruta `stage`" en abstracto — la
distinción importa: un token `operator-cli` con scope `stage` también
puede llegar a esas rutas y **no** está sujeto a este fencing, solo la
identidad del Engine lo está) debe incluir el header `X-Engine-Epoch`.
UTA lee el lease vigente de la cuenta objetivo (el `:id` de la ruta) y
compara:
- Header ausente → 401 (mismo código que "no token" — un Engine sin
  epoch no es distinguible de un Engine mal configurado).
- Header presente pero no coincide con el `epoch` persistido → 409
  (el mismo código que "lease disputado" en el punto 3 de arriba — la
  causa raíz es la misma: esta instancia ya no es, o nunca fue, la
  autoritativa).
- Lease inexistente o `engine-lease.json` corrupto/ilegible → tratar
  como "ninguna época es válida" → **denegar toda escritura de scope
  `engine`** para esa cuenta (equivalente a `HALT_NEW`, pero acotado al
  scope `engine`, no al kill switch global de R0 — el Engine queda
  bloqueado, un operador humano vía `approve`/`operator` no).

**Insertion point:** `services/uta/src/http/engine-fencing.ts` (nuevo),
montado en `main.ts` inmediatamente después de `utaAuthMiddleware()`
(Fase 4b) para las rutas de escritura de `/api/trading/uta/:id/wallet/*`
— lee `c.get('utaAuth')` (ya expuesto por el middleware de auth) y solo
actúa si `scopes.includes('engine')`. No modifica `risk-dispatcher.ts`
ni el orden R0–R20 — es una capa de identidad/vigencia, no una regla de
riesgo; corre antes de que la petición llegue al dispatcher.

### Enmienda 3 — traspaso: la instancia nueva no opera hasta reconciliar

Una concesión de lease a un `instanceId` **distinto** del holder
anterior (un traspaso real, no una renovación) es el momento exacto en
que pudo quedar un commit a medio aprobar de la instancia vieja —
`TradingGit` permite como mucho un `pendingHash` a la vez
(`add()`/`commit()` lanzan si ya hay uno pendiente, [VERIFICADO EN
REPOSITORIO] `TradingGit.ts:81-85`), así que si existe, es
inequívocamente de la instancia anterior. La instancia nueva **no
puede empezar a operar (stage/commit/push) hasta reconciliar**:

1. Tras recibir su `epoch` nuevo, antes de su primera escritura real,
   consulta `GET .../wallet/status` de la cuenta.
2. Si `pendingHash` no es `null` → lo **rechaza** vía el mecanismo ya
   existente (`POST .../wallet/reject` con `expectedPendingHash` igual
   al `pendingHash` reportado — `isPendingHashConflict`/
   `PendingHashConflictError`, [VERIFICADO EN REPOSITORIO]
   `TradingGit.ts`, ya usado por `routes-trading.ts`'s `wallet/reject`).
   **Nunca lo adopta ni lo empuja** — no tiene forma de saber si ese
   commit todavía refleja una decisión de riesgo válida bajo la política
   vigente ahora mismo.
3. El rechazo queda registrado (mismo log que cualquier
   `wallet/reject`) con una nota explícita de que fue un rechazo de
   traspaso de lease, no una decisión de un operador humano — para que
   la auditoría independiente (ADR-0010) no lo confunda con un rechazo
   de política.
4. Solo después de confirmar `pendingHash: null` la instancia nueva
   puede empezar a `stage`.

### Enmienda 4 — liberación explícita del lease

Un apagado ordenado del Engine (`SIGTERM` capturado, no un crash) llama
`POST .../engine-lease` con `release: true` antes de salir — libera el
lease de inmediato (`expiresAt = now`) para que un reinicio rápido (o
un despliegue rolling) no tenga que esperar el TTL completo. Esto
**no** toca el `epoch` en absoluto — la Enmienda 1 ya garantiza
monotonicidad independientemente de cuándo se libera; la liberación
explícita es una optimización de latencia de despliegue, no un
mecanismo de seguridad por sí sola.

## Plan de aceptación (para cuando F7 implemente esto)

- Una segunda instancia no obtiene el lease mientras la primera lo
  sostiene vigente; recibe 409 con `holder.instanceId` igual al de la
  primera.
- Al expirar el TTL (según el reloj de UTA, inyectado — nunca
  `Date.now()` real en el test), la segunda instancia toma
  `epoch + 1` (o el valor `Date.now()`-based si es mayor) y la primera
  recibe 409 en su siguiente escritura con ese epoch viejo.
- **Motor zombi tras pérdida de estado:** con el lease concedido en
  `epoch = N`, borrar `engine-lease.json` y volver a pedirlo produce un
  `epoch` estrictamente mayor que `N` (verificar `epoch > N`, no
  `epoch === 1`) — la propiedad central de la Enmienda 1.
- Un heartbeat enviado antes de `ttlSec/3` renueva `expiresAt` sin
  cambiar `epoch`; un heartbeat con un `instanceId` que no es el holder
  actual se trata igual que cualquier intento de adquisición en
  conflicto (409 con el holder real).
- `expiresAt` se evalúa exclusivamente con el reloj inyectado de
  UTA — un timestamp arbitrario en el cuerpo de la petición del
  cliente no tiene ningún efecto sobre si un lease se considera vigente
  o expirado.
- Traspaso con un commit pendiente de la instancia anterior: la
  instancia nueva lo rechaza vía `expectedPendingHash` antes de su
  primera escritura, y esa acción queda en el log distinguible de un
  rechazo de política humano.
- `release: true` del holder actual dejar el lease inmediatamente
  disponible para una nueva concesión, sin esperar el TTL.

## Consecuencias

- El Engine necesita lógica de heartbeat, manejo de 409 (con el
  `holder` para decidir con información), reconciliación post-traspaso,
  y liberación en el apagado — trabajo real de F7, no de este ADR.
- Un operador que reinicia el Engine manualmente sin esperar el TTL
  puede recibir un 409 transitorio hasta que el lease expire — esto es
  intencional (evita una ventana donde dos instancias se crean con el
  mismo `epoch`), documentado como comportamiento esperado, no un bug.
  Un apagado ordenado (Enmienda 4) evita este caso en el camino feliz.
- El fencing es específico del scope `engine`; no protege escrituras
  `approve` de un humano vía UI/Telegram (ese es un problema distinto —
  ver `S1` en `docs/trading-engine/BACKLOG.md`, Fase 4d, sobre cerrar el
  camino agente→Alice→UTA).

## Cómo revertirla

Mientras F7 no implemente esto, no hay nada que revertir — diseño
únicamente. Una vez implementado: el fencing solo se activa para
peticiones cuyo token lleva scope `engine`; un despliegue que no emita
tokens con ese scope (o que no llame nunca a `POST .../engine-lease`)
no ve ningún cambio de comportamiento — no requiere flag adicional
porque la propia ausencia de un lease vigente ya es el estado por
defecto de hoy (cero Engines desplegados, cero tokens de scope
`engine` en circulación).
