# Risk Engine

This guide owns the deterministic risk gate inside UTA — the R0–R20 rule
chain, the persistent kill switch, and the deployment-safety contract that
keeps a configured policy from silently going unenforced.

Related guides: [[docs/project-structure.md]] (UTA's role as the sole
trading-write chokepoint) and [[docs/uta-live-testing.md]] (live/paper
acceptance for anything that reaches a real broker — the RiskEngine
itself is never exercised against a real broker; it only sits in front of
one).

## Status

**[PROPUESTA] — implemented behind a flag, not yet the default.** This
guide documents the design and the current implementation as of Fase 4a
of the trading-engine work (`docs/adr/`, `docs/trading-engine/`). Fase 4b
adds UTA-side token/scope authentication; neither replaces the other.

## What it is

Every `placeOrder`/`modifyOrder` write UTA's `UnifiedTradingAccount`
dispatches passes through `RiskEngine.check` as the **first** step, before
the pre-existing guards (`services/uta/src/domain/trading/guards/`).
`closePosition` and `cancelOrder` are always allowed — the RiskEngine
never sees them, by design: reducing or cancelling exposure is never the
thing a risk gate should block.

```text
UnifiedTradingAccount dispatcher
  -> wrapDispatcherWithRiskEngine (services/uta/src/domain/trading/risk/risk-dispatcher.ts)
       -> evaluateRisk() [placeOrder/modifyOrder only]
            -> R0..R20 rule chain, first rejection wins
       -> pre-existing guard pipeline (max-position-size, cooldown, symbol-whitelist)
       -> the broker
```

Source: `services/uta/src/domain/trading/risk/`.

## The flag

`OPENALICE_RISK_ENGINE_ENABLED=1` turns the RiskEngine on. **Unset (or
any value other than `"1"`), UTA's dispatcher is byte-identical to before
the RiskEngine existed** — `wrapDispatcherWithRiskEngine` returns the
exact same dispatcher function reference, untouched. This is verified
directly: `pnpm test:owner:uta` and `pnpm test:integration:uta` produce
the identical pass counts with the flag unset as they did before the
RiskEngine was added (`docs/trading-engine/AUDIT.md` §9.4).

## Deployment safety — why a configured policy can refuse to start UTA

`OPENALICE_RISK_POLICY_PATH` set with `OPENALICE_RISK_ENGINE_ENABLED`
unset (or not `"1"`) means an operator configured a policy that is not
actually being enforced — a silent fail-open dressed up as a governed
deployment. `services/uta/src/domain/trading/risk/deployment-safety.ts`'s
`checkRiskEngineDeploymentSafety()` catches this at boot
(`services/uta/src/main.ts`, before anything else starts) and refuses to
start with a explicit error instead of quietly running ungoverned.

With the flag unset and no policy path configured (ordinary local
development), UTA still starts, but logs a visible warning that the
RiskEngine is disabled.

**Production (Fase 10) requirement: `OPENALICE_RISK_ENGINE_ENABLED=1` is
mandatory.** How this gets guaranteed operationally (systemd
`Environment=`, the Docker Compose env block, or a startup assertion in
the deploy tooling itself) is Fase 10's concern to finalize
(`deploy/RUNBOOK.md`, not yet written) — this guide records the
requirement now so Fase 10 does not have to rediscover it.

## The policy file

Read-only, host-owned, never written by any API
(`services/uta/src/domain/trading/risk/policy.ts`). Default path
`/etc/openalice/risk-policy.json`; `OPENALICE_RISK_POLICY_PATH` overrides
it (required for local development off Linux — see ADR-0004). Loading
never throws: a missing file, invalid JSON, or a schema violation all
resolve to a rejected verdict with `killSwitch: 'HALT_NEW'` rather than
crashing the process or silently allowing.

Per-account policy resolves the exact account id, falling back to a
`"default"` entry; an account with neither fails closed the same way a
missing file does.

## The R0–R20 rules

One pure function per rule under `risk/rules/`, run in numeric order —
the first rejection wins. Summary (see each `rN-*.ts` file for the exact
check):

| Rule | What it checks |
|---|---|
| R0 | Kill switch is `NORMAL` |
| R1 | Action is in the policy's `allowedActions` |
| R2 | The account resolved a policy at all |
| R3 | Symbol/secType allowlists |
| R4 | Trading hours (`'always'` for crypto-style venues, or the broker's market clock) |
| R5 | Quote freshness |
| R6 | Limit price within the price band of the live quote |
| R7 | Order notional cap |
| R8 | Resulting position notional / % equity |
| R9 | Resulting gross/net exposure |
| R10 | Resulting leverage |
| R11 | Number of open positions (new symbols only) |
| R12 | Trades per day, total and per symbol |
| R13 | Per-symbol cooldown (persistent — see M3 below) |
| R14 | A protective stop is attached or the order is itself a stop type |
| R15 | Risk per trade as % of equity |
| R16 | Daily loss limit — **triggers `HALT_NEW`** |
| R17 | Drawdown from the persistent high-water mark — **triggers `HALT_NEW`** |
| R18 | `modifyOrder` cannot increase quantity or change the stop price unverified |
| R19 | Too many consecutive rejects — **triggers `HALT_NEW`** |
| R20 | Hard capital cap (absolute, not %-of-equity) |
| R21 | Max bid/ask spread in bps (`maxSpreadBps`) — rejects on no usable bid/ask too |

**R21 (implemented, Fase 4c, A7a, [[docs/adr/0010-independent-audit.md]];
corrected 2026-09-27):** `spreadBps = (ask − bid)/mid × 10,000`,
rejected when it exceeds `policy.maxSpreadBps`. A quote is treated as
**not real bid/ask data** ("synthetic") in three cases, and rejected by
default the same as a missing quote:
1. `bid`/`ask` ≤ 0 — the sentinel CCXT/IBKR report when their ticker
   has none.
2. `bid === ask` — e.g. `brokers/others/leverup/LeverupBroker.ts` sets
   `bid: last, ask: last` (no real bid/ask split — Pyth only gives
   mid); left unchecked this would compute a spread of exactly `0` and
   pass every positive limit trivially, the opposite of protection.
3. `bid > ask` — a crossed quote, never legitimate.

Unset `maxSpreadBps` disables the rule entirely for that account, same
as every other optional policy field. **Explicit per-account opt-in:**
`policy.allowSyntheticQuotes` (default `false`) — an operator who
accepts that R21 provides no real protection for a specific account
(Leverup, or any keyless/synthetic-quote source) can set it. With it
set, a synthetic-looking quote isn't rejected — R21 simply doesn't
evaluate a spread for it (never fabricates a number from a crossed or
degenerate quote); a *real* wide spread on that same account still
rejects normally. See `rules/r21-max-spread.ts`'s docstring for why a
blanket "bid === ask" rejection (with no opt-in) was rejected in the
first pass (false positives on a real, momentarily tight market
elsewhere) in favor of this default-closed/explicit-opt-in shape.

**Which brokers give real bid/ask vs. synthetic — verified by reading
every pack before writing this rule, registered in
[[docs/trading-engine/BACKLOG.md]]:**

| Broker | Real bid/ask? |
|---|---|
| Alpaca, Longbridge, MockBroker | Yes |
| CCXT, IBKR | Yes — both fall back to `'0'` (the "absent" case above) when the underlying ticker has none |
| **Leverup** | **No** — `bid: last, ask: last` always (Pyth gives mid only) |

## Persistent state and the kill switch

`risk/risk-state.ts` persists per-account state (`data/trading/<id>/_risk/risk-state.json`)
atomically (tmp + rename — deliberately not the direct-`writeFile`
pattern `git-persistence.ts` uses, which Fase 0 flagged as non-atomic).
Windows can transiently refuse a `rename()` onto an existing destination
with `EPERM`/`EBUSY` under concurrent writers (a real finding from this
work, not from the original audit); `saveRiskState` retries a bounded
number of times before giving up.

The kill switch (`NORMAL | HALT_NEW | FLATTEN`, `risk/kill-switch.ts`)
survives a UTA restart because it is read from this same file on every
evaluation, not held in memory — verified directly: two independent
`evaluateRisk()` calls with no shared object between them still agree on
`HALT_NEW` after the first one triggers it.

A day-boundary reset clears daily counters (`tradesToday`, per-symbol
counts, `dailyStartEquity`) but **never** the kill switch itself — only an
explicit operator reset does that (`resetKillSwitch`), and a same-day
reset of an R16 (daily-loss) halt requires `force`.

**Fail-closed on state-write failure**: if the atomic write itself fails
definitively (all retries exhausted), the engine does not continue on the
in-memory state as if the write had succeeded — it forces the verdict to
`allowed: false, killSwitch: 'HALT_NEW'` and logs the failure, with a
best-effort attempt to also persist the halt (which may itself fail if
the underlying storage is broken — the in-process behavior is what
matters in that case, not a guaranteed durable record).

## M2 — strict guard resolution

`OPENALICE_RISK_STRICT=1` makes `guards/registry.ts`'s `resolveGuards`
throw on an unknown guard `type` in `accounts.json`, instead of the
default silent skip-with-`console.warn` (a Fase 0 finding: a typo
disables a guard with no visible signal). Unset, behavior is unchanged.

## M3 — cooldown guard, fixed

`guards/cooldown.ts`'s `CooldownGuard`, with the RiskEngine flag on, no
longer records a cooldown the moment its own `check()` passes (the Fase 0
defect: it could record a trade that a *later* guard in the pipeline then
rejected). Instead, `check()` defers entirely to R13 (same persistent
state), and a new `recordSuccess()` hook — called by `guard-pipeline.ts`
only after the dispatch actually resolves without throwing — writes the
cooldown. With the flag off, behavior is unchanged from before Fase 4a,
defect included.

## Independent audit (A5, Fase 4c, [[docs/adr/0010-independent-audit.md]])

`risk/audit/audit-job.ts`'s `auditAccount()` cross-checks every executed
`placeOrder`/`modifyOrder` operation in `TradingGit`'s real commit log
against `risk-decisions.jsonl`, independent of the RiskEngine/auth
preventive controls themselves — a bug in either of those could fail
silently; this doesn't share their blind spot. Correlation is exact
(`pendingHash` + `operationIndex`, threaded from `TradingGit.executePush()`
itself — see "Commit correlation" below), not fuzzy timestamp matching.

Runs once at UTA boot and daily thereafter (`main.ts`'s `auditTimer`),
per account, and no-ops entirely when the flag is off (nothing to
cross-check). On any discrepancy (a commit with no matching decision, a
rejected decision whose operation nonetheless succeeded, or an allowed
decision recorded while the kill switch was already halted):
`console.error` + `triggerKillSwitch(accountId, 'HALT_NEW', ...)` +
an entry in `data/trading/<accountId>/_risk/audit.jsonl`. A clean ledger
produces neither a log line nor a file — silence is the expected state.

A policy-hash mismatch between a past decision and the current policy
is recorded only as an informational note, never a hard finding — this
repo doesn't retain a history of past policy versions, so a normal
policy update over time isn't distinguishable from tampering without
one; treating every mismatch as a discrepancy would fail closed on
routine operator changes, not just real problems.

## Commit correlation (Fase 4c item 4 — a requisite of A5, not a follow-up)

`TradingGit.executePush()` already knows the resulting commit's hash
(computed at `commit()`, before `push()` ever calls `executeOperation`)
and each operation's position within it — both are now threaded through
`TradingGitConfig.executeOperation(op, { commitHash, operationIndex })`
into `risk-dispatcher.ts` into `evaluateRisk()`, and logged verbatim as
`RiskDecisionLogEntry.pendingHash`/`operationIndex`. `orderId` is also
logged, but **only** for `modifyOrder`/`cancelOrder` — `placeOrder` has
no client-assigned id at evaluation time (`Order.orderId` defaults to
`0` until the broker assigns one post-submission,
`packages/ibkr/src/order.ts`), so logging a meaningless `0` was rejected
in favor of omitting the field entirely.

## Verification

```bash
cd services/uta && pnpm typecheck && pnpm test
pnpm test:owner:uta                                        # flag off: identical to the pre-RiskEngine baseline
pnpm test:integration:uta                                  # same
OPENALICE_RISK_ENGINE_ENABLED=1 pnpm test:owner:uta        # flag on, no policy configured: fails closed everywhere that writes (expected, not a regression)
```

The dedicated suite lives under `services/uta/src/domain/trading/risk/*.spec.ts`
— each test configures its own policy/flag rather than relying on ambient
environment state, so it passes regardless of the flag's real-world
default.

## Change Routing

| Change | Owner path |
|---|---|
| A new or changed rule (R0–R20) | `services/uta/src/domain/trading/risk/rules/` + `rules.spec.ts` |
| Policy schema | `risk/policy.ts` + ADR-0004 if the shape changes meaningfully |
| Kill switch semantics | `risk/kill-switch.ts` + `risk-state.spec.ts` |
| Deployment-safety gate | `risk/deployment-safety.ts` + this guide's "Deployment safety" section |
| Auth on top of this (tokens/scopes) | [[docs/uta-auth.md]] (Fase 4b, ADR-0003) — a separate concern from the risk gate itself |
| A new rule past R21, or a change to the audit job | `risk/rules/` + `rules.spec.ts`, or `risk/audit/` + its specs — [[docs/adr/0010-independent-audit.md]] (Fase 4c, implemented) + [[docs/trading-engine/BACKLOG.md]] for the full registry |
| Engine lease/fencing (a second Engine instance writing concurrently) | [[docs/adr/0009-engine-lease-fencing.md]] (Fase 7) — orthogonal to the R0–R20 chain, sits in the auth/identity layer |
