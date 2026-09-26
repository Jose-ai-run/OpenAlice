# ADR-0003: Autenticación de UTA con scopes

**Estado:** Propuesto — diseño únicamente, **cero implementación en Fase 1**
**Fecha:** 2026-09-24
**Fase:** F1 (Architecture)

## Contexto

La Fase 0 confirmó, contra el código real de este commit (`0d4faa90...`,
0 commits de diferencia con el audit de referencia):

- UTA escucha en `127.0.0.1:47333` **sin ningún middleware de
  autenticación** — [VERIFICADO EN REPOSITORIO]
  `services/uta/src/main.ts:145-168` (la `Hono` app monta `createTradingRoutes`
  y `createSimulatorRoutes` directamente, sin ningún `app.use(authMiddleware)`
  previo, a diferencia de Alice).
- `POST /uta/:id/wallet/push` lleva el comentario literal "the AI tool is
  hollowed out, only humans can push" (`routes-trading.ts:502`,
  [VERIFICADO EN REPOSITORIO]) — falso desde que existe
  `agent.allowAiTrading`, y en cualquier caso irrelevante como control de
  seguridad porque **cualquier proceso local** puede golpear ese endpoint
  directamente sin pasar por la tool de Alice.
- `POST /uta/:id/wallet/place-order` encadena stage→commit→push en una sola
  llamada HTTP sin autenticación (`routes-trading.ts:594-607`,
  [VERIFICADO EN REPOSITORIO]).
- Alice sí tiene un modelo de auth (token de admin + cookie de sesión +
  bypass de loopback documentado explícitamente en
  `src/webui/middleware/auth.ts:1-20`, [VERIFICADO EN REPOSITORIO]) pero es
  un modelo de **sesión interactiva de usuario humano** (cookie, CSRF,
  Origin), no de **token de servicio máquina-a-máquina con scopes** — no
  hay un patrón de "scopes" reutilizable hoy en el repo para este caso
  (`grep -rn "scope"` en `src/webui`, `src/core`, `services/uta/src` no
  encontró ningún concepto de scope de autorización, solo usos no
  relacionados en `connectors.ts` e `inbox-store.ts`).
- Convención de secretos existente: `src/core/sealing.ts` guarda su clave
  en `<userDataHome>/sealing.key` con `chmod 0o600` best-effort
  (`sealing.ts:88`, [VERIFICADO EN REPOSITORIO]) — precedente directo para
  "secretos siempre por archivo, nunca en variables de entorno ni en git"
  que PROMPT_MASTER §9 pide para el nuevo `OPENALICE_UTA_TOKENS_FILE`.

PROMPT_MASTER §5 (M7) y §26 piden: tokens con scopes (`read`, `stage`,
`approve`, `engine`, `operator`, `simulator`) leídos de
`OPENALICE_UTA_TOKENS_FILE`; `OPENALICE_UTA_BIND_HOST` (default
`127.0.0.1`); negarse a arrancar en bind no-loopback sin tokens; en
loopback sin tokens → modo compatibilidad con warning.

Esta Fase 1 **diseña** ese mecanismo (este ADR) pero **no lo implementa**:
el mandato explícito de esta fase es "NO toques `src/` ni `services/uta/`
todavía. Las modificaciones M1–M12 son de fases posteriores." La
implementación real de M7/M8 llega en la fase que las module (probablemente
F4, junto al RiskEngine, dado que ambas tocan el único punto de escritura).

## Opciones consideradas

### Opción A — Reusar el modelo de sesión de Alice (cookie + CSRF)

- Descartada para UTA. Ese modelo asume un navegador con cookies y Origin
  header; el Engine y los agentes headless son clientes HTTP puros
  máquina-a-máquina, sin sesión de usuario ni concepto de Origin. Forzar
  cookies ahí sería una capa de complejidad que no resuelve el problema
  real (autorización por capacidad, no identidad de sesión).

### Opción B — Bearer token único, sin scopes

- Descartada. PROMPT_MASTER pide explícitamente diferenciar `read` de
  `operator` — un token único no puede expresar "Alice puede leer y stage
  pero no accionar kill-switch" ni "el Engine puede leer y operar en modo
  `engine` pero no aprobar por Telegram". Un solo nivel de privilegio para
  UTA reproduce el problema actual (cualquiera que llegue al puerto puede
  todo), solo que detrás de un secreto compartido.

### Opción C — Bearer tokens con scopes, archivo de tokens fuera de git — **elegida**

## Decisión (diseño, no implementación)

**Formato del archivo** (`OPENALICE_UTA_TOKENS_FILE`, JSON, 0600, nunca en
git — mismo patrón que `sealing.key`):

```json
{
  "version": 1,
  "tokens": [
    { "token": "<random ≥32 bytes, base64url>", "scopes": ["read", "stage", "approve"], "label": "alice" },
    { "token": "<random ≥32 bytes, base64url>", "scopes": ["read", "engine"], "label": "engine-service" },
    { "token": "<random ≥32 bytes, base64url>", "scopes": ["read", "stage", "approve", "operator"], "label": "operator-cli" }
  ]
}
```

- `token` es el secreto en sí (comparación en tiempo constante, no `===`
  directo — el mismo cuidado que ya aplica `src/webui/middleware/auth.ts`
  a su cookie de sesión, [VERIFICADO EN REPOSITORIO] por el nombre de sus
  playbooks referenciados: `safe/playbooks/01-auth-bypass.md`).
- Scopes fijados por PROMPT_MASTER §26: `read`, `stage`, `approve`,
  `engine`, `operator`, `simulator`. Este ADR no añade scopes nuevos.
- Un token puede tener varios scopes (composición, no jerarquía implícita
  — `operator` no incluye automáticamente `simulator`, por ejemplo, para
  que la política de menor privilegio sea explícita por token).

**Transporte:** header `Authorization: Bearer <token>` en cada request a
UTA — igual que M8 en PROMPT_MASTER §5 pide para `UTAClient` y
`trading-proxy.ts`.

**Middleware (`services/uta/src/http/auth.ts`, no existe hoy —
[VERIFICADO EN REPOSITORIO] `services/uta/src/http/` solo tiene
`routes-trading.ts` y `routes-simulator.ts`):**

- Cada ruta declara el/los scope(s) mínimos que requiere (ver mapeo abajo).
- Verifica el bearer token contra el archivo cargado en memoria al boot
  (recarga en `SIGHUP` o reinicio, igual que la política de riesgo del
  ADR-0004 — mismo mecanismo de recarga para ambos archivos RO).
- Sin token válido → 401. Token válido pero sin el scope requerido → 403.

**Mapeo scope → ruta (basado en las rutas ya inventariadas en Fase 0,
`routes-trading.ts`):**

| Scope | Rutas cubiertas |
|---|---|
| `read` | `GET`/lecturas: cuenta, posiciones, órdenes, `/historical`, `/quote` |
| `stage` | `POST /wallet/stage-place-order`, `stage-modify-order`, `stage-close-position`, `stage-cancel-order` |
| `approve` | `POST /wallet/push`, `POST /wallet/place-order` (one-shot), `POST /wallet/close-position` |
| `engine` | Scope propio del Engine — lectura + stage, sin `approve` ni `operator` (el Engine nunca ejecuta directamente; ver ADR-0006 y PROMPT_MASTER §12 "No añadas tools de trading que ejecuten órdenes") |
| `operator` | Kill-switch, reset, endpoints administrativos nuevos de `routes-risk.ts` (ADR-0004) |
| `simulator` | `/api/simulator/*` — desactivado fuera de paper/dev por PROMPT_MASTER §26 |

**`OPENALICE_UTA_BIND_HOST`** (no existe hoy — Fase 0 confirmó
"NO ENCONTRADO EN EL REPOSITORIO", el host está fijo en `127.0.0.1` en
`services/uta/src/main.ts:175`): default `127.0.0.1`.

**Modo compatibilidad:** si `OPENALICE_UTA_TOKENS_FILE` no está configurado
**y** el bind sigue siendo loopback → UTA arranca igual que hoy (sin auth),
pero **debe emitir un warning explícito en el log de arranque** en cada
inicio, no solo la primera vez. Si el bind no es loopback y no hay archivo
de tokens → **UTA se niega a arrancar** (falla cerrado, mismo espíritu que
el RiskEngine del ADR-0004).

## Consecuencias

- Cambia el contrato de todo cliente de UTA (Alice, el futuro Engine,
  cualquier script de prueba) — deben empezar a mandar `Authorization`.
  Por eso PROMPT_MASTER lo agrupa con M7+M8 en la misma fase de
  implementación: cambiar el servidor sin actualizar los clientes a la vez
  rompería Alice.
- El modo de compatibilidad preserva el flujo de desarrollo local actual
  (loopback sin tokens configurados) para no bloquear a alguien que solo
  quiere levantar `pnpm dev` sin configurar nada — a costa de mantener el
  agujero de seguridad de Fase 0 activo *por defecto* hasta que el
  operador configure el archivo de tokens explícitamente. Esto es una
  decisión deliberada de no romper el "quickstart" existente, documentada
  aquí para que quede visible, no oculta.

## Cómo revertirla

El middleware de auth se implementará detrás de la misma condicional que
ya usa el modo compatibilidad: sin `OPENALICE_UTA_TOKENS_FILE`, el
comportamiento es idéntico al actual. Revertir a "sin auth" en cualquier
momento es simplemente no configurar (o borrar) esa variable de entorno —
no hay migración de datos ni cambio de formato persistido involucrado.

## Implementación (Fase 4b, 2026-09-26)

Implementado tal como se diseñó arriba — ver [[docs/uta-auth.md]] para el
detalle operativo y `docs/trading-engine/AUDIT.md` §10 para la salida de
verificación real. Una desviación deliberada respecto al diseño original:

- **Recarga del archivo de tokens:** este ADR anticipaba una caché en
  memoria con recarga por `SIGHUP`. Ningún mecanismo de recarga por señal
  existe en el resto del repositorio — `risk/policy.ts` (ADR-0004)
  estableció el precedente real (releer el archivo en cada uso, sin
  caché). La implementación de M7 sigue ese mismo precedente: el archivo
  de tokens se relee en cada request. Esto sacrifica un `readFile`
  adicional por request (insignificante frente a un round-trip al
  broker) a cambio de revocación instantánea de un token editando el
  archivo, sin necesidad de construir ni mantener correcto un mecanismo
  de recarga por señal.
