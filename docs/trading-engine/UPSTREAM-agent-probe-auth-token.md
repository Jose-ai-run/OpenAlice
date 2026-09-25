# Upstream finding: `probeAnthropic` leaks ambient `ANTHROPIC_AUTH_TOKEN` into the `Authorization` header

**Fecha:** 2026-09-25
**Reportado por:** Claude Sonnet 5 (sesión de auditoría del motor de trading, `feat/engine-*`)
**Severidad:** Media — ver "Por qué importa" abajo (no es un bypass de auth de OpenAlice ni RCE; es una fuga de credencial ambiental hacia un endpoint configurable por el usuario)
**Estado:** Abierto — diagnosticado, **NO arreglado** (ver "Alcance de este documento")
**Relacionado:** `safe/playbooks/05-credential-leakage.md` (existe como entrada TBD en `safe/README.md`, el archivo en sí aún no se ha escrito — ver "Canal de reporte" abajo)

Este documento es independiente de las fases del motor de trading
(`docs/trading-engine/AUDIT.md`, `docs/adr/*`). No forma parte del alcance
de `PROMPT_MASTER_CLAUDE_CODE.md` — es un hallazgo sobre código existente
de Alice (`src/workspaces/agent-probe.ts`) encontrado como efecto
colateral de establecer la línea base de tests en la Fase 0.

## Alcance de este documento

Diagnóstico únicamente. **No se modificó ningún código.** Si se decide
arreglar esto, debe hacerse en una rama nueva `fix/agent-probe-auth-token`
(no en ninguna rama `feat/engine-*`, que está reservada para el motor de
trading nuevo), con un spec que aísle explícitamente el entorno, y con
aprobación humana explícita antes de implementar — instrucción directa
recibida para este hallazgo.

## Síntoma

`src/workspaces/agent-probe.spec.ts`, suite `probeAnthropic auth header`,
dos casos fallan cuando se ejecutan en un entorno donde
`ANTHROPIC_AUTH_TOKEN` está definida (como esta propia sesión de trabajo):

- `defaults to x-api-key (Anthropic first-party)` — espera
  `headers['authorization']` `undefined`, recibe un valor con forma de
  Bearer token.
- `uses x-api-key when authMode is x-api-key` — mismo síntoma.

Ambos casos pasan explícitamente un `apiKey` de prueba (`'sk-default'`,
`'sk-xak'`) y **no** pasan `authMode: 'bearer'` — es decir, piden
explícitamente el modo `x-api-key`, que según el comentario del propio
código (`agent-probe.ts:63-65`) debería enviar **solo** el header
`x-api-key`, nunca `Authorization`.

## Causa

`src/workspaces/agent-probe.ts:62-68`:

```ts
const client = input.authMode === 'bearer'
  ? new Anthropic({ authToken: input.apiKey, baseURL: input.baseUrl, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 })
  : new Anthropic({ apiKey: input.apiKey, baseURL: input.baseUrl, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 })
```

Cuando `authMode !== 'bearer'`, el código construye el cliente
`@anthropic-ai/sdk` pasando **solo** `apiKey`. El propio SDK trata
`apiKey` y `authToken` como dos slots de credencial independientes:

- `apiKey` (explícito o `process.env.ANTHROPIC_API_KEY`) → header `x-api-key`.
- `authToken` (explícito o `process.env.ANTHROPIC_AUTH_TOKEN`) → header
  `Authorization: Bearer`.

No pasar `authToken` explícitamente **no** desactiva ese segundo slot — el
SDK sigue mirando `process.env.ANTHROPIC_AUTH_TOKEN` por su cuenta,
independientemente de que el llamador solo quisiera usar `apiKey`. El
resultado es que **ambos** headers se envían si esa variable de entorno
está presente, aunque el llamador haya pedido `x-api-key` explícitamente
y crea que está enviando un único header controlado por él.

## Escenario de riesgo (más allá de este test)

El mismo mecanismo aplica en el camino de producción, no solo en el test.
`probeAnthropic` (vía `src/workspaces/agent-probe.ts`) es el motor detrás
del botón "Test" de la configuración de credenciales de un Workspace —
el usuario introduce una URL base (`baseUrl`) y una clave, y el sistema
hace una llamada real a esa URL para verificar que funciona.

Si el proceso de Alice (o el proceso hijo que evalúa el probe) tiene
`ANTHROPIC_AUTH_TOKEN` en su entorno por **cualquier** motivo legítimo no
relacionado — por ejemplo, porque el propio Alice corre dentro de un
harness de agente que inyecta esa variable para sus propios fines (como
literalmente ocurre en esta sesión de trabajo) — y un usuario configura
`probeAnthropic` con `authMode: 'x-api-key'` (el default) contra un
`baseUrl` de un **tercero** (cualquier gateway "Anthropic-compatible": la
docstring del propio test menciona "MiniMax's international endpoint"
como ejemplo real de este patrón), ese `ANTHROPIC_AUTH_TOKEN` ambiental
viaja igual, sin que el usuario lo sepa ni lo haya pedido, al servidor de
ese tercero.

No se verificó en esta fase si ese escenario es alcanzable en un despliegue
real de OpenAlice (requeriría que el proceso de Alice tenga esa variable
en su entorno, lo cual no es el caso por defecto según lo revisado en
Fase 0 — `src/workspaces/spawn-env.ts` limpia varias variables antes de
pasarlas a los PTYs de los Workspaces, pero **no se verificó** si
`ANTHROPIC_AUTH_TOKEN` específicamente está entre ellas ni si el propio
proceso de Alice —no un Workspace hijo— podría heredarla de su propio
entorno de arranque). Se documenta el mecanismo con la severidad que
amerita la incertidumbre, no una certeza de explotabilidad en producción.

## Arreglo propuesto (no implementado)

Pasar explícitamente el slot que **no** se está usando, para que el SDK
no caiga a su propio fallback de entorno:

```ts
const client = input.authMode === 'bearer'
  ? new Anthropic({ authToken: input.apiKey, apiKey: null, baseURL: input.baseUrl, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 })
  : new Anthropic({ apiKey: input.apiKey, authToken: null, baseURL: input.baseUrl, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 })
```

(Verificar contra la versión instalada de `@anthropic-ai/sdk` si `null`
es el valor que efectivamente suprime el fallback a
`process.env` para ese slot, o si el SDK requiere `undefined` explícito
combinado con una opción de constructor separada tipo
`dangerouslyAllowBrowser`/`fetchOptions` — no verificado en esta fase,
es tarea de quien implemente el fix en `fix/agent-probe-auth-token`.)
El spec de regresión para ese fix debe fijar explícitamente
`process.env.ANTHROPIC_AUTH_TOKEN` (y `ANTHROPIC_API_KEY`) a un valor
sintético antes de cada test y restaurarlos después — el test actual no
aísla el entorno, que es la causa raíz de que este síntoma solo aparezca
en algunos entornos de ejecución y no en otros.

## Cómo reproducirlo sin credenciales reales

```bash
cd C:/AliceTrader/OpenAlice
# Variable sintética, NO una credencial real — cualquier string sirve
# para demostrar el fallback del SDK.
ANTHROPIC_AUTH_TOKEN='synthetic-non-secret-repro-marker-000' \
  corepack pnpm vitest run src/workspaces/agent-probe.spec.ts -t 'defaults to x-api-key'
```

**Esperado (correcto):** el test pasa — `headers['authorization']` es
`undefined` porque solo se pidió `x-api-key`.

**Observado (el bug):** el test falla — `headers['authorization']` es
`'Bearer synthetic-non-secret-repro-marker-000'`, el valor exacto de la
variable de entorno sintética, demostrando el fallback sin necesitar
ninguna credencial real. Este comando es seguro de ejecutar en cualquier
máquina, incluida CI, porque el valor es un marcador inventado, no un
secreto.

## Código de referencia

- `src/workspaces/agent-probe.ts:62-68` — construcción del cliente, causa raíz.
- `src/workspaces/agent-probe.spec.ts:61-67,69-73` — los dos casos que fallan hoy en un entorno con `ANTHROPIC_AUTH_TOKEN` definida; no aíslan el entorno.

## Canal de reporte verificado

El repositorio **no tiene** `SECURITY.md` (ni en la raíz ni en `.github/`)
ni ningún proceso de GitHub Security Advisories configurado
([VERIFICADO EN REPOSITORIO]: `find . -maxdepth 2 -iname "SECURITY.md"` sin
resultados; `.github/` solo contiene `workflows/`).

El repo sí tiene un kit interno de seguridad en `safe/` (`safe/README.md`,
[VERIFICADO EN REPOSITORIO]), pero es explícitamente un **kit de
red-team/pentest interno de un solo operador**, no un canal de
divulgación de vulnerabilidades de terceros — "This folder is checked in.
It's public. That's by design — the attack surface is the attacker's
already-known territory". El canal correspondiente para un hallazgo como
este, **si decidís incorporarlo formalmente**, es un archivo nuevo en
`safe/findings/YYYY-MM-DD-<título>.md` siguiendo la plantilla de
`safe/findings/README.md`, idealmente enlazado a
`safe/playbooks/05-credential-leakage.md` — que hoy figura como entrada
**TBD** en el layout de `safe/README.md` (el archivo del playbook en sí
todavía no existe en el repo).

**No filé nada en `safe/findings/` yo mismo** — ese flujo de trabajo es de
un operador ejecutando una sesión de red-team dedicada (`safe/AGENT_BRIEF.md`),
distinto de esta sesión de auditoría del motor de trading; y no se pidió
explícitamente. Este documento (`docs/trading-engine/UPSTREAM-agent-probe-auth-token.md`)
es el registro completo mientras tanto. No se abrió ningún issue, PR ni
advisory público — nada se envió fuera de este checkout local.
