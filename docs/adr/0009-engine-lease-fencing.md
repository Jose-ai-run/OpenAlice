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
Request:  { accountId: string, instanceId: string, ttlSec: number }
Response: { epoch: number, expiresAt: string }
```

Semántica de la petición:
1. Sin lease previo, o lease previo con `expiresAt` ya pasado →
   conceder: `epoch = epochAnterior + 1` (o `1` si nunca hubo lease),
   `expiresAt = now + ttlSec`, persistir, responder `{epoch, expiresAt}`.
2. Lease vigente sostenido por el **mismo** `instanceId` (heartbeat) →
   renovar `expiresAt`, **mismo** `epoch` (una renovación no es un
   cambio de autoridad).
3. Lease vigente sostenido por **otro** `instanceId` → rechazar (409):
   la instancia llamante no es la autoritativa todavía.

**Persistencia:** `data/trading/<accountId>/_risk/engine-lease.json`
— mismo directorio `_risk/` que `risk-state.json`, mismo mecanismo
atómico tmp+rename con reintento acotado ante `EPERM`/`EBUSY`
(`risk-state.ts` es el precedente literal a reutilizar, no reinventar).
Forma: `{ accountId, instanceId, epoch, expiresAt, updatedAt }`.

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

**Heartbeat:** el propio Engine llama al mismo endpoint periódicamente
(a menos de `ttlSec`) con su `instanceId` para renovar sin perder el
`epoch`. Si no lo hace a tiempo, el lease expira y cualquier instancia
(incluida la misma, si vuelve) puede tomarlo de nuevo con `epoch+1` —
lo cual automáticamente invalida cualquier escritura en vuelo de la
instancia anterior, sea zombi o no.

## Consecuencias

- El Engine necesita lógica de heartbeat y de manejo de 409 (ceder,
  volver a pedir el lease, o detenerse) — trabajo real de F7, no de
  este ADR.
- Un operador que reinicia el Engine manualmente sin esperar el TTL
  puede recibir un 409 transitorio hasta que el lease expire — esto es
  intencional (evita una ventana donde dos instancias se crean con el
  mismo `epoch`), documentado como comportamiento esperado, no un bug.
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
