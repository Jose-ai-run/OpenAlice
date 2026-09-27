# UTA Auth (bearer tokens + scopes)

This guide owns UTA's bearer-token authentication layer — the tokens
file, the scope-gated HTTP middleware, `OPENALICE_UTA_BIND_HOST`, and the
deployment-safety contract that keeps a non-loopback bind from silently
running unauthenticated.

Related guides: [[docs/project-structure.md]] (UTA's role as the sole
trading-write chokepoint) and [[docs/risk-engine.md]] (the R0–R20 risk
gate this auth layer sits in front of — a separate concern: auth answers
"who is calling," the risk gate answers "should this specific order be
allowed").

## Status

**[PROPUESTA] — implemented behind a compatibility fallback, not yet
mandatory.** This guide documents Fase 4b of the trading-engine work
(`docs/adr/0003-uta-token-auth.md`, `docs/trading-engine/`). ADR-0003
designed this mechanism in Fase 1; this phase implements M7 (server-side
tokens/scopes) and M8 (client-side `Authorization: Bearer`) exactly as
designed, with one deliberate deviation noted below.

## What it is

Every request under `/api/trading/*` and `/api/simulator/*` passes
through `utaAuthMiddleware()` (`services/uta/src/http/auth.ts`) before
reaching the route handlers. `/__uta/health` is mounted before the
middleware and stays public — Guardian's readiness probe and Alice's BFF
health check must not need a token.

```text
Hono app
  -> GET /__uta/health                         (always public)
  -> /api/trading/*, /api/simulator/*
       -> utaAuthMiddleware()  [services/uta/src/http/auth.ts]
            -> compatibility mode: pass through unchanged
            -> enforced mode: Bearer token -> scope check -> 401/403/next
       -> createTradingRoutes() / createSimulatorRoutes()
```

Source: `services/uta/src/domain/trading/auth/`, `services/uta/src/http/auth.ts`.

## The tokens file

`OPENALICE_UTA_TOKENS_FILE` — host-owned, read-only JSON, 0600, never in
git (same convention as `sealing.key` and the risk policy file):

```json
{
  "version": 1,
  "tokens": [
    { "token": "<random ≥32 bytes, base64url>", "scopes": ["read", "stage", "approve"], "label": "alice" },
    { "token": "<random ≥32 bytes, base64url>", "scopes": ["read"], "label": "engine-service" },
    { "token": "<random ≥32 bytes, base64url>", "scopes": ["read", "stage", "approve", "operator"], "label": "operator-cli" }
  ]
}
```

Scopes are fixed: `read`, `stage`, `approve`, `engine`, `operator`,
`simulator` (`services/uta/src/domain/trading/auth/types.ts`). A token
can carry several — composition, not hierarchy (`operator` does not
imply `simulator`, for example), so least privilege stays explicit per
token. `engine` itself gates no route directly; it is an identity label
ADR-0003 reserves for the Engine's token (which otherwise needs only
`read`, since Fase 4b's only wired Engine route — historical bars — is a
`read`-scoped route; the Engine never carries `approve` or `operator`
because it never executes directly, per ADR-0006).

Loading never throws: a missing file, invalid JSON, or a schema
violation all resolve to the middleware returning 503 rather than
crashing the process or silently allowing every request through.

**Deviation from ADR-0003:** the ADR anticipated an in-memory cache
reloaded on SIGHUP. No SIGHUP-reload mechanism exists anywhere else in
this codebase — `risk/policy.ts` established the real precedent instead
(re-read the file fresh on every use, no cache). This implementation
follows that same precedent: the tokens file is re-read on every
request. Trade-off: one small `readFile` per request (negligible next to
a broker round-trip) in exchange for instant token revocation by editing
the file, with no reload mechanism to build or keep correct.

**Enforced-vs-compatibility is decided ONCE, at boot (correction A.1,
2026-09-27).** `main.ts` resolves `OPENALICE_UTA_TOKENS_FILE` exactly
once at startup and passes that fixed path into `utaAuthMiddleware()` as
a closure value — the middleware never re-reads the env var per
request. This matters specifically because the file itself is still
re-read fresh on every request (previous paragraph): if UTA started in
enforced mode and a *later* read fails — the file got deleted, a write
left it truncated mid-flight, an operator emptied it by mistake — every
request is denied (401/503) with a logged `console.error` alert. It is
never reinterpreted as "auth was never configured" and silently
downgraded to compatibility mode. Only an actual process restart with
the env var unset produces compatibility mode. Verified directly:
`services/uta/src/http/auth.spec.ts`'s "never falls back to
compatibility mode" suite starts an app with a valid tokens file,
deletes/corrupts/empties it mid-run, confirms every request is denied
in each case, then restores valid content and confirms it recovers.

**Production: mount the tokens file read-only.** Whoever can write this
file can grant themselves `operator` (or any other scope) instantly —
the file's authorization is exactly as strong as its write permission.
Fase 10's deployment mounts it as a Docker secret or a `:ro` bind,
outside any tree the running process (or an agent it might be
compromised into running) can write to. In local development,
`checkTokensFileDevLocation()` (`domain/trading/auth/deployment-safety.ts`)
logs an explicit `console.warn` at boot if the configured path resolves
inside `OPENALICE_HOME` — and a sharper one if it resolves inside a
Workspace specifically, since a Workspace is exactly the untrusted-local-
code surface this token is meant to gate. This is advisory only (pure
path comparison, no filesystem access, so it still runs even if the file
doesn't exist yet) — it does not block startup the way the bind-host
gate does, because a dev machine legitimately has no other convenient
place to put it.

## Scope → route mapping

`services/uta/src/http/auth.ts`'s `requiredScope()` computes the
required scope from method + path — no route handler carries auth logic
itself. Falls back to `operator` for anything unmatched, so a new route
defaults to the most privileged scope until someone deliberately loosens
it.

| Scope | Routes |
|---|---|
| `read` | Every `GET` under `/api/trading/*`, plus the read-only `POST` routes that just happen to carry a JSON body (`quote`, `historical`, `contracts/details`, `contract/option-*`, `contract/order-book`, `contract/expand`) |
| `stage` | `POST .../wallet/stage-place-order`, `stage-modify-order`, `stage-close-position`, `stage-cancel-order`, `commit`, `reject`, and `.../uta/:id/sync` (writes a real commit — see below) |
| `approve` | `POST .../wallet/push`, `place-order`, `close-position`, `cancel-order` (the one-shot stage→commit→push routes) |
| `operator` | Everything else under `/api/trading/*` not covered above (`reconnect`, `simulate-price`, `test-connection`, `DELETE .../snapshots/:timestamp`) — the conservative default |
| `simulator` | Every route under `/api/simulator/*` |

**Every write route that resolves to `read` — the complete list, with
justification (correction 2026-09-27):** these seven, and only these
seven, are `POST` routes gated by `read` instead of a write scope. Each
one is a pure lookup that happens to carry a structured `Contract`/query
payload in its body instead of query-string params — none of them
creates, modifies, cancels, or reconnects anything:

| Route | Why `read` is correct |
|---|---|
| `POST .../uta/:id/quote` | Looks up a live quote for a contract — the `POST` form exists only because the request body carries a full `Contract` object, not because it writes anything. Identical in effect to the `GET .../quote/:symbol` sibling route. |
| `POST .../uta/:id/historical` | Fetches OHLCV bars from the broker — a pure read, and the route the Engine's `read`-scoped token calls (`services/engine/src/uta/uta-client.ts`). |
| `POST .../uta/:id/contracts/details` | Contract-details lookup after a search hit — no broker state changes. |
| `POST .../uta/:id/contract/option-contracts` / `option-chain` | Broker-side option-chain research reads. |
| `POST .../uta/:id/contract/order-book` | Reads the live order book for a contract. |
| `POST .../uta/:id/contract/expand` | Expands a hub contract (bond issuer, option chain, futures months) into its leaves — a catalog lookup, not a mutation. |

**Corrected in this review — routes that must NOT be `read`:** the
initial pass correctly kept these off `read`, but grouped `sync` with
the pure administrative actions under `operator`, which is stricter
than it needs to be. Corrected to `stage`, its true minimum:

| Route | Scope | Why |
|---|---|---|
| `DELETE .../uta/:id/snapshots/:timestamp` | `operator` | Deletes a persisted snapshot — destructive, administrative. |
| `POST .../uta/:id/reconnect` | `operator` | Tears down and recreates the broker connection — administrative, not a trading action. |
| `POST /test-connection` | `operator` | Receives broker **credentials** in the request body to test them — the most sensitive route in the file, must never be reachable by anything less than `operator`. |
| `POST .../uta/:id/sync` | `stage` (not `operator`) | Writes a real commit reflecting fill/cancel status changes (`UnifiedTradingAccount.sync()` → `this.git.sync(updates, state)`, [VERIFICADO EN REPOSITORIO]) — a genuine state write, not an admin action, so an Engine-scoped token (`read`+`stage` only, never `operator`) can legitimately call it without being handed broader privilege than it needs. |

**Default-deny audit (correction A.2, 2026-09-27):**
`services/uta/src/http/route-scope-audit.spec.ts` enumerates every route
Hono's own `app.routes` reports for `createTradingRoutes()` and
`createSimulatorRoutes()` — not a hand-maintained list that can drift
from the real app — and checks each one against an explicit expectation
table. A route the table doesn't know about fails the test, forcing a
deliberate scope decision before it can ship silently on the `operator`
fallback. A write-verb route (non-`GET`/`HEAD`) that resolves to `read`
fails unless it's on the explicit allowlist above (the seven pure
market-data/account reads that happen to carry a JSON body) — this is
the check that catches a future route accidentally under-protected by a
too-broad regex in `SCOPE_RULES`.

## `OPENALICE_UTA_BIND_HOST`

Default `127.0.0.1`. `services/uta/src/domain/trading/auth/deployment-safety.ts`'s
`checkUtaAuthDeploymentSafety()` runs at boot (`main.ts`, alongside the
RiskEngine's own gate): a non-loopback bind with no tokens file
configured refuses to start — UTA is the sole trading-write chokepoint,
so exposing it off-loopback with no way to authenticate callers is a
structural hole, not a disabled feature. On loopback with no tokens file
configured, UTA still starts (today's behavior, unchanged) but logs an
explicit "compatibility mode" warning on every start.

## Client side (M8)

`Authorization: Bearer <token>` is attached wherever UTA is called, only
when a token is actually configured — omitted entirely in compatibility
mode (UTA ignores the header either way, so this is safe regardless):

- `packages/uta-protocol/src/client/UTAClient.ts` — `UTAClientOptions.token`.
  Alice's `src/main.ts` passes `process.env.OPENALICE_UTA_TOKEN` here;
  this is the single credential the AI tool layer, the trading-config UI
  routes, and Telegram's trading approvals all share, since they all go
  through this one client instance.
- `src/webui/routes/trading-proxy.ts` — the browser-facing BFF proxy does
  a raw `fetch()`, not `UTAClient`, so it separately attaches the same
  `OPENALICE_UTA_TOKEN` (wired in `src/webui/plugin.ts`) as its own
  outbound header. It never forwards the *incoming* request's own
  `Authorization` header — the browser authenticates to Alice via session
  cookie (`src/webui/middleware/auth.ts`), a completely separate boundary
  from Alice's own service identity toward UTA.
- `services/engine/src/uta/uta-client.ts` — `EngineUtaClientOptions.token`,
  for the Engine's own credential once its runtime wires one in.

## Closing the agent→Alice→UTA path (Fase 4d, S1)

Before this, a local process with no Alice session at all — including an
agent's own shell inside a Workspace — could reach Alice's `/api/trading/*`
proxy, `/api/simulator/*`, or `/api/config/*` and have Alice's own
session-cookie auth simply not apply, because
`src/webui/middleware/auth.ts`'s loopback bypass trusted **any** loopback
caller with no/trusted Origin, for every method, before the session check
ever ran. Once past that bypass, the request rode Alice's own
`approve`-scoped `OPENALICE_UTA_TOKEN` through the proxy straight to UTA.

**Fix (`src/webui/middleware/auth.ts`, `AuthMiddlewareOptions.requireSessionForSensitiveWrites`):**
a mutating request under `/api/trading`, `/api/simulator`, or
`/api/config` no longer takes the loopback bypass — it falls through to
the real session-cookie + CSRF check, even from loopback. Reads are
unaffected. `src/webui/plugin.ts` passes `true` whenever a real TCP
listener is bound (dev, browser, Docker — `config.listen !== false`)
and `false` in Electron app mode, where `config.listen === false` and
the only transport is Electron main's own IPC relay
(`src/webui/web-ipc.ts`) — nothing external can dial into that at all,
so there was never a shared-port attack surface there to close.

**Verified NOT to break the two in-process approval paths**, which were
never HTTP calls to Alice's own webui port in the first place — both
call `UTAManagerSDK`/`UTAAccountSDK` directly, in-process, which in turn
talks to UTA with Alice's own token the same way the proxy does, just
without ever touching `src/webui/middleware/auth.ts`:
- Telegram (`src/services/connector-client/uta-review.ts` — `uta.push(...)`).
- The `tradingPush` AI tool (`src/tool/trading.ts` — `uta.push(...)`).

Existing specs for both re-run unchanged and green as proof
(`uta-review.spec.ts`, `trading.spec.ts`), confirming neither path was
touched by this change.

**UTA side — engine-owned accounts (`services/uta/src/http/engine-account-guard.ts`):**
the RO risk policy can mark a specific account `engineOwned: true`
(`domain/trading/risk/policy.ts`). On such an account, staging or
committing requires the caller's token to carry the `engine` scope
specifically — not merely any `stage`-scoped token (an `operator-cli`
token, or Alice's own `read`+`stage`+`approve` token, both get 403
`ENGINE_ACCOUNT_REQUIRES_ENGINE_SCOPE`). Push is not separately gated
here: it still requires `approve` (unchanged), and since `TradingGit`
allows only one pending commit at a time, whatever a human approves on
an engine-owned account can only ever be the commit the Engine itself
staged — "HUMAN_APPROVAL mode" falls out of the stage-gating plus that
existing invariant, with no second mechanism needed to track "who
created this pendingHash."

**`/cli` (workspace CLI shims) — verified acceptable, not a gap.**
`src/server/cli.ts`'s `POST /cli/:wsId/:export/invoke` is deliberately
unauthenticated — "no admin-token gate, the workspace CLI carries no
secret" — because it is the *normal, intended* surface a Workspace
agent's own shell uses (`alice`, `alice-uta`, etc.). That's fine
precisely because it inherits nothing extra: `/cli`'s trading tools
(`placeOrder`, `tradingCommit`, `tradingPush`, ...) call the exact same
in-process `UTAManagerSDK` — Alice's one `OPENALICE_UTA_TOKEN` — that
Telegram and the `tradingPush` AI tool already use, never a separately
privileged credential. So an agent invoking trading tools via `/cli` is
bounded by exactly the same two controls documented above: it can never
present an `engine`-scoped token (that credential is never in Alice's
process at all), and `tradingPush` still stops at the `allowAiTrading`
gate.

Verified with a real, non-fabricated test exercising the actual `/cli`
dispatch chain (`registerCliRoutes`, tool-name resolution, Zod arg
validation, the real `createTradingTools` staging logic) —
`src/server/cli-trading-guard.spec.ts`:
- Staging on an engine-owned account via `/cli` fails: UTA's real 403
  (independently proven in `engine-account-guard.spec.ts`'s "Alice's
  own token shape" case) propagates through as a `/cli` tool-error
  response (`500 { error: "Error: Forbidden" }` — `server/cli.ts`
  turns a tool `isError` result into a flat 500, discarding the
  UTA-side `code`/`detail` fields down to just the top-level `error`
  string; a minor observability gap, not a security one — staging
  never silently succeeds either way).
- `tradingPush` via `/cli` with `agent.allowAiTrading=false` never
  calls UTA's push endpoint at all — it returns "requires manual
  approval" and stops (the test's fake UTA `fetch` throws if push is
  ever reached, so a silent execution would fail the test, not pass
  it quietly). The reverse control (`allowAiTrading=true` DOES push)
  is tested too, proving the gate is real, not a no-op that happens to
  look right.

The one piece intentionally **not** re-verified inside this test is
UTA's own HTTP response — that's `engine-account-guard.spec.ts`'s job,
for real, against the real middleware chain. Splitting it this way
(rather than importing UTA's internals into Alice's test suite, or vice
versa) keeps the test honest about the actual process boundary between
the two services (`docs/project-structure.md`) instead of pretending
they're one program.

**Residual risk, until Fase 10 (documented, not closed here):** Alice,
UTA, and any Workspace agent still run as the **same OS user** on the
same host. Nothing in this change stops a Workspace agent's shell from
reading Alice's own files directly — its config, its session store, its
sealed credentials file (still sealed, but the sealing key sits beside
it on the same filesystem) — or from reading `OPENALICE_UTA_TOKEN` out
of Alice's own environment if it can inspect Alice's process. This
change closes the *HTTP* path (a local process can no longer forge an
authenticated-looking request to Alice's trading surface without a real
session); it does not, and cannot, close the *filesystem* path — that
requires actual OS-level isolation (separate containers/users, read-only
credential mounts) between Alice, UTA, and any Workspace's agent
process, which is Fase 10's job, not this one's.

## Verification

```bash
cd services/uta && pnpm typecheck && pnpm test
pnpm test:owner:uta         # flag off (no OPENALICE_UTA_TOKENS_FILE): identical to compatibility-mode baseline
pnpm test:integration:uta   # same
```

The dedicated suite lives in `services/uta/src/domain/trading/auth/*.spec.ts`
and `services/uta/src/http/auth.spec.ts` — each test configures its own
tokens file rather than relying on ambient environment state, so it
passes regardless of whether auth is enforced in the real deployment.

## Change Routing

| Change | Owner path |
|---|---|
| A new route's required scope | `services/uta/src/http/auth.ts`'s `SCOPE_RULES` + `auth.spec.ts` |
| Tokens file schema / scopes | `domain/trading/auth/types.ts` + ADR-0003 if the shape changes meaningfully |
| Bind-host / deployment-safety gate | `domain/trading/auth/deployment-safety.ts` + this guide's "bind host" section |
| Client-side header wiring | `packages/uta-protocol/src/client/UTAClient.ts`, `src/webui/routes/trading-proxy.ts`, `services/engine/src/uta/uta-client.ts` |
| The risk gate this sits in front of | [[docs/risk-engine.md]] — a separate concern |
