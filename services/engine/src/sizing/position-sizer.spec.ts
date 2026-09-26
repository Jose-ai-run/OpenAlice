import { describe, expect, it } from 'vitest'
import { sizePosition } from './position-sizer.js'

describe('sizePosition', () => {
  it('sizes a whole-share instrument by risk budget / risk-per-unit', () => {
    // equity 100,000 * 1% risk = 1,000; entry 100, stop 98 -> risk/unit 2 -> 500 shares.
    const result = sizePosition({ equity: 100_000, riskPct: 0.01, entry: 100, stop: 98, minQty: 1, lotSize: 1 })
    expect(result.quantity.toString()).toBe('500')
  })

  it('rounds DOWN to the nearest lotSize, never up past the risk budget', () => {
    // risk 1,000 / risk-per-unit 3 = 333.33...; lotSize 10 -> floors to 330, not 340.
    const result = sizePosition({ equity: 100_000, riskPct: 0.01, entry: 103, stop: 100, minQty: 1, lotSize: 10 })
    expect(result.quantity.toString()).toBe('330')
  })

  it('rounds down to a fractional lotSize (crypto-style step size)', () => {
    // risk 100 / risk-per-unit 1000 = 0.1; lotSize 0.001 -> 0.1 exactly / 0.001 = 100 lots -> 0.1.
    const result = sizePosition({ equity: 10_000, riskPct: 0.01, entry: 51_000, stop: 50_000, minQty: 0.001, lotSize: 0.001 })
    expect(result.quantity.toString()).toBe('0.1')
  })

  it('returns 0 when the risk-sized quantity falls below minQty', () => {
    // risk 10 / risk-per-unit 1000 = 0.01, but minQty is 0.1 -> can't size safely, return 0.
    const result = sizePosition({ equity: 1_000, riskPct: 0.01, entry: 51_000, stop: 50_000, minQty: 0.1, lotSize: 0.001 })
    expect(result.quantity.toString()).toBe('0')
  })

  it('returns 0 (never divides by zero) when entry equals stop', () => {
    const result = sizePosition({ equity: 100_000, riskPct: 0.01, entry: 100, stop: 100, minQty: 1, lotSize: 1 })
    expect(result.quantity.toString()).toBe('0')
  })

  it('is symmetric for a short (stop above entry)', () => {
    const long = sizePosition({ equity: 100_000, riskPct: 0.01, entry: 100, stop: 98, minQty: 1, lotSize: 1 })
    const short = sizePosition({ equity: 100_000, riskPct: 0.01, entry: 98, stop: 100, minQty: 1, lotSize: 1 })
    expect(short.quantity.toString()).toBe(long.quantity.toString())
  })
})
