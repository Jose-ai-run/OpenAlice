# Trading Engine

This guide is the top-level index for the deterministic trading-engine
build-out (`services/engine/`, plus the UTA-side additions it depends
on — RiskEngine, auth, and now the audit/lease work). It does not
duplicate the detail already owned elsewhere; it points to it.

## Subsystem guides

- [[docs/risk-engine.md]] — the R0–R20 deterministic risk gate, kill
  switch, deployment-safety flag contract.
- [[docs/uta-auth.md]] — bearer tokens, scopes, `OPENALICE_UTA_BIND_HOST`,
  the compatibility-mode/enforced-mode boot-time decision.
- [[docs/trading-engine/BACKLOG.md]] — the full registry of every
  improvement considered from the `bennyjo/phil` analysis: active,
  frozen (pending Fase 8), optional, and rejected, with acceptance
  criteria and the ADR each one designs against.
- [[docs/trading-engine/AUDIT.md]] — the running session log for every
  phase of this work (Fase 0 through the current one), with real
  command output at each step. The authoritative "what actually
  happened and when," not a summary.
- [[docs/trading-engine/ACCOUNTS.md]] — the three accounts configured
  for engine/RiskEngine testing (`bybit-readonly`, `engine-paper`, and
  the not-yet-created Bybit-demo template).
- [[docs/trading-engine/UPSTREAM-agent-probe-auth-token.md]] — an
  upstream finding (SDK auth-token leak in `src/workspaces/agent-probe.ts`)
  discovered during this work but deliberately kept separate — it is
  not part of any engine phase and needs its own approved branch.

## ADRs

`docs/adr/0001` through `0006` cover the original architecture
(engine-as-separate-service, SQLite driver, UTA token auth design,
risk-policy RO file, execution modes, engine read tools).
`docs/adr/0008` through `0010` (no `0007` — not written) cover the
`bennyjo/phil`-derived registry:

- [[docs/adr/0008-dated-evidence-counterfactual-ledger.md]] — dated
  evidence per strategy version (`frozen_at`) and the counterfactual
  ledger for blocked signals.
- [[docs/adr/0009-engine-lease-fencing.md]] — the fencing-token
  mechanism preventing two concurrent Engine instances from writing for
  the same account.
- [[docs/adr/0010-independent-audit.md]] — the after-the-fact audit job
  that cross-checks every executed `TradingGit` commit against its
  `risk-decisions.jsonl` entry, independent of the preventive controls
  themselves.

## Phase status

See [[docs/trading-engine/AUDIT.md]] for the authoritative, real-output
record. As of this guide's last update: Fase 0 through Fase 4b
(UTA bearer-token auth, corrections A.1–A.3) are complete and verified.
Fase 4c (independent audit + R21 spread rule), Fase 4d (closing the
agent→Alice→UTA write path), and the rest of `BACKLOG.md`'s active
items each land in their own phase, gated on explicit approval per the
mandate's rules.
