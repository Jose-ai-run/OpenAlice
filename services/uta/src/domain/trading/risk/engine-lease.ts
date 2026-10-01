/**
 * [PROPUESTA] Engine lease + fencing (A6) — F7, implementing ADR-0009
 * exactly as designed (including its Enmiendas 1/2/4) — see
 * docs/adr/0009-engine-lease-fencing.md for the full rationale. This file
 * is the state machine only; the HTTP route lives in routes-risk.ts, the
 * per-write fencing check in engine-fencing.ts.
 *
 * Persistence: data/trading/<accountId>/_risk/engine-lease.json, same
 * atomic tmp+rename mechanism as risk-state.ts (the ADR's own instruction:
 * reuse that precedent, don't reinvent it) via atomic-file.ts.
 */
import { readFile } from 'node:fs/promises'
import { dataPath } from '@/core/paths.js'
import { atomicWriteFile } from '../atomic-file.js'

export interface EngineLease {
  accountId: string
  instanceId: string
  epoch: number
  /** ISO timestamp — evaluated only against UTA's own injected clock, never a client-supplied value (Enmienda 2). */
  expiresAt: string
  updatedAt: string
}

export type LeaseAcquireResult =
  | { ok: true; epoch: number; expiresAt: string }
  | { ok: false; holder: { instanceId: string; expiresAt: string } }

export type LeaseReleaseResult =
  | { ok: true }
  | { ok: false; reason: string }

function leaseFilePath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'engine-lease.json')
}

async function loadLease(accountId: string): Promise<EngineLease | undefined> {
  try {
    return JSON.parse(await readFile(leaseFilePath(accountId), 'utf-8')) as EngineLease
  } catch {
    return undefined
  }
}

async function saveLease(accountId: string, lease: EngineLease): Promise<void> {
  await atomicWriteFile(leaseFilePath(accountId), JSON.stringify(lease, null, 2))
}

/**
 * Enmienda 1 — the granted epoch is `max(previousEpoch + 1, now.getTime())`,
 * never simply `previousEpoch + 1`: wall-clock milliseconds only advance
 * with real time, so even a fully lost/deleted lease file (treated as
 * `previousEpoch = 0`) still yields an epoch astronomically larger than any
 * small sequential epoch a zombi instance might repeat by chance. This is
 * NOT a cryptographic guarantee — it assumes UTA's own clock doesn't jump
 * backward significantly (documented in the ADR, not hidden here either).
 */
function nextEpoch(previousEpoch: number, now: Date): number {
  return Math.max(previousEpoch + 1, now.getTime())
}

function isExpired(lease: EngineLease, now: Date): boolean {
  return new Date(lease.expiresAt).getTime() <= now.getTime()
}

/**
 * Acquire or renew the engine lease for `accountId`.
 *
 * - No lease, or an expired one (per UTA's own `now`, never a client
 *   timestamp) → grant: new epoch (Enmienda 1), `expiresAt = now + ttlSec`.
 * - Held by the SAME `instanceId` → renew: same epoch, new `expiresAt`.
 * - Held by a DIFFERENT, still-valid `instanceId` → reject: `{ok:false,
 *   holder}` (maps to HTTP 409 at the route layer) — the caller decides
 *   with the holder's identity in hand rather than retrying blind.
 */
export async function acquireOrRenewLease(
  accountId: string, instanceId: string, ttlSec: number, now: Date,
): Promise<LeaseAcquireResult> {
  const existing = await loadLease(accountId)
  const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString()

  if (!existing || isExpired(existing, now)) {
    const epoch = nextEpoch(existing?.epoch ?? 0, now)
    await saveLease(accountId, { accountId, instanceId, epoch, expiresAt, updatedAt: now.toISOString() })
    return { ok: true, epoch, expiresAt }
  }

  if (existing.instanceId === instanceId) {
    await saveLease(accountId, { ...existing, expiresAt, updatedAt: now.toISOString() })
    return { ok: true, epoch: existing.epoch, expiresAt }
  }

  return { ok: false, holder: { instanceId: existing.instanceId, expiresAt: existing.expiresAt } }
}

/**
 * Enmienda 4 — explicit release on an ordered shutdown. Only the current
 * holder may release; this does NOT touch `epoch` (monotonicity never
 * depends on when a lease is released, only Enmienda 1's formula).
 */
export async function releaseLease(accountId: string, instanceId: string, now: Date): Promise<LeaseReleaseResult> {
  const existing = await loadLease(accountId)
  if (!existing) return { ok: true }  // nothing to release
  if (existing.instanceId !== instanceId) {
    return { ok: false, reason: `lease is held by "${existing.instanceId}", not "${instanceId}" — cannot release someone else's lease` }
  }
  await saveLease(accountId, { ...existing, expiresAt: now.toISOString(), updatedAt: now.toISOString() })
  return { ok: true }
}

export type LeaseFencingCheck =
  | { ok: true }
  | { ok: false; code: 'NO_LEASE' | 'EPOCH_MISMATCH'; message: string; currentEpoch?: number }

/**
 * Enmienda 2 — fencing check for a write carrying scope `engine` and an
 * `X-Engine-Epoch` header (already extracted by the caller — this function
 * takes the parsed epoch, not the raw header, so engine-fencing.ts owns
 * the 401-on-missing-header case per the ADR: "Header ausente -> 401" is
 * indistinguishable from "no token" and handled before this is ever called).
 */
export async function checkLeaseFencing(accountId: string, presentedEpoch: number, now: Date): Promise<LeaseFencingCheck> {
  const existing = await loadLease(accountId)
  if (!existing || isExpired(existing, now)) {
    return { ok: false, code: 'NO_LEASE', message: `no valid engine lease for account "${accountId}" — the engine scope is blocked for writes until one is acquired` }
  }
  if (existing.epoch !== presentedEpoch) {
    return { ok: false, code: 'EPOCH_MISMATCH', message: `presented epoch ${presentedEpoch} does not match the current lease epoch ${existing.epoch} — this instance is no longer (or never was) authoritative`, currentEpoch: existing.epoch }
  }
  return { ok: true }
}

/** Exposed for the status route / tests — never used to make a fencing decision from outside this module. */
export async function getLeaseStatus(accountId: string): Promise<EngineLease | undefined> {
  return loadLease(accountId)
}
