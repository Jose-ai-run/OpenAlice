# Cuentas de trading — configuración para las Fases 2+

**Fecha:** 2026-09-25
**Máquina:** esta máquina de desarrollo (Windows), `OPENALICE_HOME` por
defecto: `C:\Users\Jose\.openalice` (no existía antes de este trabajo —
`readUTAsConfig()`/`loadConfig()` lo crean y materializan `sealing.key` en
su primer uso, comportamiento propio de la app, no algo que yo haya
diseñado).

Todo lo de este documento se configuró ejecutando el propio código de
OpenAlice (`readUTAsConfig`/`writeUTAsConfig`/`writeConfigSection` de
`src/core/config.ts`, vía un script `.mts` throwaway en `data/` —
gitignoreado, borrado después de usarlo, siguiendo la convención de
`docs/uta-live-testing.md`), no escribiendo JSON a mano — así se respeta
el sellado real de `accounts.json` (AES-256-GCM) y la validación Zod, en
vez de adivinar el formato.

## 1. Fuente keyless de datos — Bybit (Fase 2)

**Cambio:** `trading.json` → `keylessDataSources: ["bybit"]`.

**Archivo real:** `<OPENALICE_HOME>/data/config/trading.json` (plano, sin
sellar — no hay credenciales en esta sección):

```json
{
  "observeExternalOrdersEvery": "15m",
  "keylessDataSources": ["bybit"]
}
```

**UTA resultante (verificado por lectura de código, no adivinado):**
`buildKeylessDataUTAs()` (`services/uta/src/domain/trading/keyless-data-sources.ts`)
construye, por cada entrada de `keylessDataSources`, un `UTAConfig` con
`id: "${exchange}-readonly"`. Para `"bybit"`, el id resultante es:

```
bybit-readonly
```

confirmado ejecutando el código real (no solo leyéndolo): el UTA generado
fue exactamente

```json
{
  "id": "bybit-readonly",
  "label": "Bybit (read-only data)",
  "presetId": "ccxt-custom",
  "keyless": true,
  "readOnly": true,
  "asVendor": true,
  "editable": false,
  "presetConfig": { "exchange": "bybit" }
}
```

No se persiste en `accounts.json` — es una UTA sintética que
`services/uta/src/main.ts` reconstruye en cada arranque a partir de
`trading.json` (`buildKeylessDataUTAs`, ver `main.ts:71`, Fase 0
[VERIFICADO EN REPOSITORIO]).

**Broker pack CCXT en modo source/dev — verificado, no asumido:**
`services/uta/src/domain/trading/brokers/registry.ts` resuelve el motor
`ccxt` en este orden: (1) si `OPENALICE_BROKER_PACK_PREFER_WORKSPACE=1`
y el launcher es dev/test, carga directo desde
`packages/uta-broker-ccxt/src/index.ts`; (2) si no, busca un broker pack
**instalado** en `<OPENALICE_HOME>/runtime/broker-packs/ccxt/` (no existe
en esta máquina — `runtime/` ni siquiera se ha creado); (3) si no hay uno
instalado, cae a `workspacePacksAllowed()`
(`registry.ts:131-136`), que devuelve `true` automáticamente cuando
`OPENALICE_LAUNCHER === 'dev'` — variable que `scripts/guardian/dev.ts:270`
fija **automáticamente** al correr `pnpm dev`. Conclusión verificada: bajo
`pnpm dev`, sin ningún broker pack instalado y sin ninguna variable de
entorno adicional, CCXT se carga igual desde
`packages/uta-broker-ccxt/src/index.ts` — el "modo source/dev" que pedías
verificar **funciona sin configuración extra**.

**Para qué fase:** Fase 2 (Market Data) — fuente de barras keyless para
`services/engine/src/data/` cuando se implemente.

## 2. Cuenta paper — `engine-paper` (Fases 3+, uso real desde Fase 5)

**Archivo real:** `<OPENALICE_HOME>/data/config/accounts.json` (sellado,
AES-256-GCM — confirmado con `head -c 200` sobre el archivo real:
`{"$sealed":1,"alg":"aes-256-gcm","iv":"...","tag":"...","data":"..."}`).
Contenido real, leído de vuelta con `readUTAsConfig()` (no reconstruido a
mano):

```json
{
  "id": "engine-paper",
  "label": "Engine paper (mock-simulator, non-ephemeral)",
  "presetId": "mock-simulator",
  "enabled": true,
  "guards": [],
  "presetConfig": { "cash": 100000, "_instanceId": "engine-paper" },
  "ephemeral": false,
  "keyless": false,
  "readOnly": false,
  "asVendor": false,
  "editable": true
}
```

**Por qué `ephemeral: false` explícitamente:** `ephemeral: true` purga la
cuenta (config + `data/trading/<id>/`) en cada arranque de UTA (Fase 0,
[VERIFICADO EN REPOSITORIO] `src/core/config.ts`, comentario del schema:
"Test/throwaway UTA — purged at every server startup"). El paper trading
de la Fase 5 (PROMPT_MASTER §23: "Cuenta `mock-simulator` **no efímera**")
necesita historial persistente entre reinicios del Engine/UTA para que
el PriceFeeder y el ledger de TradingGit tengan sentido — una cuenta
efímera rompería esa continuidad en cada reinicio de desarrollo.

**Sin claves:** `mock-simulator` no tiene credenciales — es un exchange en
memoria (Fase 0, hallazgo 9). `presetConfig` solo lleva `cash` (capital
inicial simulado) e `_instanceId` (normalmente lo asigna la ruta HTTP al
crearla desde la UI; se lo puse yo mismo aquí, igual al id de la cuenta,
para que sea determinista).

**Para qué fase:** existe desde ahora (prerequisito), pero **no se usa
activamente** hasta la Fase 5 (Paper trading) y como target de pruebas en
Fase 3 (tests de estrategias) — las Fases 2 y 3 según el modo máximo de
PROMPT_MASTER (`RESEARCH_ONLY`, `SIGNAL_ONLY`) no hacen stage/commit/push
de ninguna orden, así que esta cuenta no recibe tráfico de trading
todavía, solo existe para que Fase 5 no tenga que crearla desde cero.

## 3. Cuenta Bybit demo — plantilla SIN crear, SIN claves

**No se creó ninguna entrada en `accounts.json` para esto** — a
diferencia de `engine-paper`, una cuenta Bybit demo necesita una API
key/secret reales generadas en Bybit, que yo no tengo ni debo inventar.
Lo que sigue es la plantilla exacta que se necesitaría, documentada aquí
(no en JSON, porque JSON no admite comentarios y esto no debe activarse
solo) para cuando decidas generarla.

**Qué necesitás generar vos, en Bybit:**

1. Entrá a Bybit → **modo Demo Trading** (no la cuenta real — Bybit separa
   completamente demo de live; ver PROMPT_MASTER §24 y
   `packages/uta-protocol/src/brokers/preset-catalog.ts`, preset Bybit con
   modos `live | testnet | demo`, Fase 0 [VERIFICADO EN REPOSITORIO]
   §2.4-(9): "demo = datos reales con matching simulado").
2. Generá una API key **desde la cuenta demo**, no desde la cuenta real —
   Bybit las separa; una key de la cuenta live no sirve para el endpoint
   demo y viceversa.
3. Anotá `apiKey` y `apiSecret`. No los pegues en ningún archivo de este
   repo, ni me los pases a mí en el chat — van directo a la app (paso
   siguiente).

**Dónde va (cuando lo hagas vos, vía la UI de OpenAlice, no a mano):**

Settings → Trading → Add Account → preset **Bybit**, modo **Demo** → la UI
pide `apiKey`/`apiSecret` y los sella automáticamente al guardar (mismo
mecanismo AES-256-GCM que ya sella `engine-paper`). Forma final esperada
en `accounts.json` (sellado — esto es solo la forma lógica, no el archivo
real, que nunca es legible en texto plano):

```jsonc
// NO EXISTE TODAVÍA — plantilla de referencia, sin claves.
{
  "id": "engine-bybit-demo",          // sugerido; vos elegís el id real
  "label": "Bybit Demo (engine)",
  "presetId": "bybit",                 // o el id exacto que use el catálogo de presets para Bybit
  "enabled": true,
  "guards": [],                        // los guards existentes (max-position-size, cooldown,
                                        // symbol-whitelist) siguen aplicando aquí incluso antes
                                        // del RiskEngine de la Fase 4
  "presetConfig": {
    "mode": "demo"                     // NUNCA "live" para este propósito
    // apiKey / apiSecret: los pone la UI al guardar, selladas — nunca en este archivo a mano
  },
  "ephemeral": false,
  "keyless": false,
  "readOnly": false,
  "asVendor": false,
  "editable": true
}
```

**Por qué no puede quedar configurada sin vos:** no tengo (ni debo pedir)
credenciales reales de ningún servicio externo — está en las reglas
permanentes de esta sesión. Generar una API key de Bybit, aunque sea
"solo demo", es una acción en un servicio de terceros que te pertenece a
vos, no a mí.

**Para qué fase:** Fase 8 (Testnet — PROMPT_MASTER: "Hasta
`FULLY_AUTOMATED` **solo en cuentas demo/testnet**", catálogo de
escenarios S1–S14 de `docs/uta-live-testing.md`). También sirve antes,
opcionalmente, para pruebas puntuales con datos reales de venue en Fase 2
si en algún momento el dato keyless de `bybit-readonly` no alcanza —pero
no es un prerequisito de Fase 2, que ya tiene su fuente de datos con el
punto 1 de este documento.

## Objetivo final de automatización — registrado, NO activado

El objetivo declarado es la cuenta demo en `FULLY_AUTOMATED` (modo 6 de
ADR-0005). **Hoy no se activa nada de esto** — ni en este documento ni en
ninguna configuración tocada en esta sesión se fijó ningún modo de
ejecución que implique automatización, porque el motor **no tiene
todavía ninguna lógica que automatizar** (Fases 2/3 son
`RESEARCH_ONLY`/`SIGNAL_ONLY` — ni siquiera hacen stage de órdenes).

**Qué debe existir antes de que `FULLY_AUTOMATED` sea siquiera
planteable**, en orden (de PROMPT_MASTER, tabla de fases + ADR-0005):

1. **Fase 4 — RiskEngine determinístico** (dentro de UTA, M1 de
   PROMPT_MASTER §5): sin esto, no hay ningún techo automático de riesgo
   que UTA pueda aplicar — sería literalmente lo que Fase 0 encontró como
   el hallazgo más grave (guards que fallan abiertos, sin kill switch).
2. **Fase 7 — ExecutionManager** (WAL, máquina de estados de intents,
   reconciliación): sin esto, no hay ninguna forma segura de que el
   Engine ejecute repetidamente sin duplicar órdenes tras un reinicio o
   un fallo de red.
3. **Fase 8 — Aceptación de venue** (catálogo S1–S14 completo contra la
   cuenta Bybit demo de este documento, sección 3, cuenta plana al
   final): sin esto, no hay evidencia de que el venue específico
   (Bybit demo) se comporte como el código asume — exactamente la
   filosofía de `docs/uta-live-testing.md` ("no unit test... catches
   these").

**Qué configuración exacta lo activaría, cuando llegue el momento**
(según ADR-0005, mínimo entre 4 fuentes — ninguna de las cuatro está
fijada a `FULLY_AUTOMATED` hoy, ni debe estarlo):

- `ENGINE_MODE=FULLY_AUTOMATED` (env del proceso Engine).
- `executionModeMax` en `risk-policy.json` (archivo RO del host, ADR-0004)
  ≥ 6, para la cuenta `engine-bybit-demo` específicamente.
- `mode_cap` de cada estrategia en `strategies.yaml` ≥ 6 — y solo para
  estrategias que ya hayan pasado el gate de backtest/paridad de la
  Fase 6.
- El "modo de la cuenta" nuevo en `accounts.json` (campo que ADR-0005
  anticipa pero no diseña en detalle — ver ADR-0005 §Consecuencias) ≥ 6
  para `engine-bybit-demo`.

Mientras cualquiera de las cuatro fuentes esté por debajo de 6 (todas lo
están hoy, porque ninguna de las cuatro existe todavía como
configuración real), el modo efectivo nunca puede ser `FULLY_AUTOMATED`
— es aritméticamente imposible por diseño (mínimo de las cuatro), no una
promesa de proceso.
