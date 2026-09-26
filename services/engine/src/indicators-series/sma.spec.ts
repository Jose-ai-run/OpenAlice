import { describe, expect, it } from 'vitest'
import { smaSeries } from './sma.js'

describe('smaSeries', () => {
  it('computes the trailing mean, null before the window fills', () => {
    const out = smaSeries([1, 2, 3, 4, 5], 3)
    expect(out).toEqual([null, null, 2, 3, 4])
  })

  it('respects no-lookahead: truncating future values does not change past ones', () => {
    const full = smaSeries([1, 2, 3, 4, 5, 6], 3)
    const truncated = smaSeries([1, 2, 3, 4], 3)
    expect(truncated).toEqual(full.slice(0, 4))
  })
})
