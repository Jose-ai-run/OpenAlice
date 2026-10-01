# Demo local — Hito 1 Parte 2 (Windows)

[PROPUESTA] Comandos reales, verificados en esta sesión (PowerShell/Git
Bash en Windows 11, Node v24.12.0, pnpm 11.7.0 vía `corepack`). Ningún
valor de credencial se escribe en este documento.

## 0. Prerequisitos (una sola vez)

```bash
cd C:/AliceTrader/OpenAlice
pnpm install
cd packages/guardian-runtime && pnpm build && cd ../..
```

Cuenta `engine-paper` (MockBroker, no efímera, cash inicial 100000) ya
debe existir en `~/.openalice/data/config/accounts.json` (sellado,
AES-256-GCM — ver [[docs/trading-engine/ACCOUNTS.md]] para la plantilla
exacta; este documento nunca lee ni escribe ese archivo).

## 1. Levantar UTA (puerto 47333)

Fuera de Guardian/`pnpm dev` (no disponible en este flujo de trabajo —
ver [[docs/trading-engine/AUDIT.md]] §14.2 para el porqué de cada
variable):

```bash
cd services/uta
OPENALICE_LAUNCHER=dev \
OPENALICE_APP_HOME="C:/AliceTrader/OpenAlice" \
NODE_OPTIONS="--conditions=openalice-source" \
OPENALICE_RISK_ENGINE_ENABLED=1 \
OPENALICE_RISK_POLICY_PATH="C:/AliceTrader/OpenAlice/deploy/examples/risk-policy.example.json" \
corepack pnpm exec tsx src/main.ts
```

`OPENALICE_RISK_ENGINE_ENABLED=1` + `OPENALICE_RISK_POLICY_PATH` son
necesarios para que el RiskEngine (R0–R21) y el kill switch tengan
efecto real — sin ellos, `wrapDispatcherWithRiskEngine` deja el
dispatcher sin tocar (ver [[docs/trading-engine/AUDIT.md]] §18).

Verificar que ambas cuentas existen de verdad (no inventadas):

```bash
curl -s http://127.0.0.1:47333/api/trading/uta
```

Debe listar `bybit-readonly` (datos, sin clave) y `engine-paper`
(MockBroker, soporta `MKT/LMT/STP/STP LMT`).

## 2. Levantar el Engine (puerto 47340)

En otra terminal:

```bash
cd services/engine
OPENALICE_UTA_URL=http://127.0.0.1:47333 corepack pnpm exec tsx src/main.ts
```

Esto solo expone `GET /engine/health` y, si ya existe
`services/engine/config/engine-config.canary.json` +
`services/engine/data/paper-canary.db` (o las rutas que indiques con
`ENGINE_CONFIG_PATH`/`ENGINE_DB_PATH`), también la página de estado de
solo lectura:

- JSON: `http://127.0.0.1:47340/engine/status`
- HTML: `http://127.0.0.1:47340/`

Ambas en loopback únicamente, sin autenticación — es un proceso interno
de desarrollo, no expuesto a la red (igual que UTA y Alice).

## 3. Correr el canario PAPER (entrada con stop protector → salida)

En otra terminal, con UTA ya corriendo:

```bash
cd services/engine
OPENALICE_UTA_URL=http://127.0.0.1:47333 \
corepack pnpm exec tsx src/cli/paper-canary.ts config/engine-config.canary.json data/paper-canary.db 1500
```

Busca una señal `ENTER` real de `trend-following` en las últimas 1500
velas 1h reales de Bybit (nunca fabricada — si no encuentra ninguna,
falla explícitamente con `NO ENCONTRADO`), ejecuta la entrada con un
stop protector real (orden `STP` separada, ver §18 de
[[docs/trading-engine/AUDIT.md]] sobre por qué va en un commit aparte),
prueba el reinicio a mitad de ciclo (sin duplicados) y el kill switch, y
termina con la cuenta plana. Tarda ~2 minutos (incluye una espera real
de 65s por el cooldown R13 entre la entrada y el stop).

Verificar el resultado real en Trading-as-Git:

```bash
curl -s http://127.0.0.1:47333/api/trading/uta/engine-paper/wallet/log
```

## 4. Iniciar sesión en la UI de Alice (para la prueba de 24h, cuando se apruebe)

La UI de Alice (no el Engine) exige sesión para escrituras sensibles
(`/api/trading`, `/api/simulator`, `/api/config`) en cuanto corre un
puerto real. El token de administrador:

- Se genera solo, la primera vez que arranca Alice, y se imprime UNA
  VEZ en la consola de arranque (`src/webui/plugin.ts`,
  `bootstrapToken`). Si ya arrancó antes en esta máquina, el token ya
  fue impreso en algún momento pasado — este documento no lo reproduce.
- Se usa en `POST /api/auth/login` con `{ "token": "..." }`; la sesión
  queda en una cookie `alice_session` (httpOnly).
- **Para regenerarlo**: borra `data/config/auth.json` (bajo
  `OPENALICE_HOME`) y reinicia Alice — un token nuevo se genera e
  imprime una sola vez en esa consola. Nunca lo pegues en un chat, PR
  ni documento.
- Una petición desde loopback (127.0.0.1/::1) sin proxy de confianza
  configurado sigue pasando sin sesión para TODO excepto esas rutas
  sensibles — ver `src/webui/middleware/auth.ts`.

## 5. Prueba de 24 horas (NO iniciar sin aprobación explícita)

Pendiente — requiere aprobación humana explícita antes de lanzarse (ver
[[docs/trading-engine/STATUS.md]]). Cuando se apruebe, este documento
se actualizará con el comando exacto del scheduler real (no el replay
driver) y el criterio de aceptación (24 ciclos completos a tiempo, sin
errores, datos frescos).

## 6. Apagar todo

```bash
# Ctrl+C en cada terminal (UTA, Engine), o:
pkill -f "tsx src/main.ts" 2>/dev/null || true
```

El canario deja la cuenta `engine-paper` plana (posición cerrada, sin
órdenes pendientes) al terminar con éxito — confirmar con
`GET /api/simulator/uta/engine-paper/state` si quedó alguna duda.
