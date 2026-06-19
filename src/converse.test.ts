import { expect, test } from 'vitest'
import { refineTurn } from './converse.js'
import type { ZoneStat } from './types.js'

const zone: ZoneStat = {
  path: '/z', name: 'Downloads', totalFiles: 3, totalBytes: 3,
  byType: { '.png': { count: 2, bytes: 2 }, '.pdf': { count: 1, bytes: 1 } },
  approxDuplicateBytes: 0, biggestFiles: [], looseFileCount: 3,
}

test('parses a reply with a new strategy', async () => {
  const client = {
    complete: async () =>
      JSON.stringify({
        reply: 'Sure — keeping screenshots in place.',
        strategy: {
          summary: 'tidy minus screenshots',
          folders: [{ name: 'Images', accepts: ['image'] }],
          quarantineDuplicates: true, quarantineJunk: true, renameMessy: true,
          keep: ['screenshot'],
        },
      }),
  }
  const out = await refineTurn(zone, 'current plan...', [], 'clean everything except screenshots', client)
  expect(out.reply).toMatch(/screenshots/)
  expect(out.strategy?.keep).toContain('screenshot')
})

test('parses a clarifying question (no strategy)', async () => {
  const client = {
    complete: async () => JSON.stringify({ reply: 'Which files count as important?', strategy: null }),
  }
  const out = await refineTurn(zone, 'current plan...', [], 'keep the important ones', client)
  expect(out.reply).toMatch(/important/)
  expect(out.strategy).toBeNull()
})

test('rejects malformed output', async () => {
  await expect(
    refineTurn(zone, 'p', [], 'hi', { complete: async () => 'not json' }),
  ).rejects.toThrow(/did not understand/i)
})
