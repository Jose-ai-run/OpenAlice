import { describe, expect, it } from 'vitest'
import { hashBars } from './hash.js'
import { cleanDailyBars } from './test-fixtures.js'

describe('hashBars', () => {
  it('same dataset content, twice, produces the same hash', () => {
    // PROMPT_MASTER_CLAUDE_CODE.md §37 F2: "descargar las mismas barras dos
    // veces -> mismo hash". Two distinct array instances, identical content.
    const first = hashBars(cleanDailyBars())
    const second = hashBars(cleanDailyBars())
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('different content produces a different hash', () => {
    const bars = cleanDailyBars()
    const mutated = bars.map((b, i) => (i === 2 ? { ...b, close: '999.99' } : b))
    expect(hashBars(bars)).not.toBe(hashBars(mutated))
  })

  it('empty dataset hashes deterministically', () => {
    expect(hashBars([])).toBe(hashBars([]))
  })
})
