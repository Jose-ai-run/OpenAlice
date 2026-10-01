import { describe, expect, it } from 'vitest'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-file.js'

describe('atomicWriteFile', () => {
  it('writes content readable back exactly, creating the directory if needed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atomic-file-test-'))
    const filePath = join(dir, 'nested', 'file.json')
    await atomicWriteFile(filePath, JSON.stringify({ a: 1 }))
    expect(JSON.parse(await readFile(filePath, 'utf-8'))).toEqual({ a: 1 })
  })

  it('a second write replaces the first cleanly (no leftover tmp file content)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atomic-file-test-'))
    const filePath = join(dir, 'file.json')
    await atomicWriteFile(filePath, 'first')
    await atomicWriteFile(filePath, 'second')
    expect(await readFile(filePath, 'utf-8')).toBe('second')
  })

  it('concurrent writes to the same path never collide on the tmp path (unique per call)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atomic-file-test-'))
    const filePath = join(dir, 'file.json')
    await Promise.all([
      atomicWriteFile(filePath, 'a'),
      atomicWriteFile(filePath, 'b'),
      atomicWriteFile(filePath, 'c'),
    ])
    // Whichever wins, the file must contain exactly one of them — never
    // corrupted/concatenated content from a tmp-path collision.
    expect(['a', 'b', 'c']).toContain(await readFile(filePath, 'utf-8'))
  })
})
