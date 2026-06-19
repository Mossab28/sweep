import { expect, test } from 'vitest'
import { createStrategy, expandStrategy } from './strategy.js'
import type { Index, Strategy } from './types.js'

const index: Index = {
  root: '/z',
  totalFiles: 4,
  totalBytes: 10,
  byType: {},
  duplicates: [{ hash: 'h', size: 2, paths: ['a.png', 'b.png'] }],
  files: [
    { path: 'a.png', name: 'a.png', ext: '.png', size: 2, mtime: 0, hash: 'h' },
    { path: 'b.png', name: 'b.png', ext: '.png', size: 2, mtime: 0, hash: 'h' },
    { path: 'invoice copy.pdf', name: 'invoice copy.pdf', ext: '.pdf', size: 3, mtime: 0 },
    { path: 'old.dmg', name: 'old.dmg', ext: '.dmg', size: 1, mtime: 0 },
  ],
}

const strategy: Strategy = {
  summary: 's',
  folders: [
    { name: 'Images', accepts: ['image'] },
    { name: 'Documents', accepts: ['document'] },
  ],
  quarantineDuplicates: true,
  quarantineJunk: true,
  renameMessy: true,
}

test('expandStrategy routes, dedupes, quarantines junk, renames', () => {
  const now = Date.UTC(2026, 5, 19)
  const plan = expandStrategy(index, strategy, '/z', '/trash/x', now)
  const ops = plan.operations
  expect(ops).toContainEqual({ op: 'mkdir', path: 'Images' })
  // one png kept & moved, the other quarantined as duplicate
  const movedPng = ops.filter((o) => o.op === 'move' && o.to.startsWith('Images/'))
  expect(movedPng).toHaveLength(1)
  expect(ops.filter((o) => o.op === 'quarantine').map((o) => (o.op === 'quarantine' ? o.path : '')))
    .toEqual(expect.arrayContaining(['old.dmg']))
  // messy pdf renamed on move into Documents
  expect(ops).toContainEqual({ op: 'move', from: 'invoice copy.pdf', to: 'Documents/invoice.pdf' })
})

test('expandStrategy de-duplicates colliding destination names', () => {
  const collide: Index = {
    root: '/z',
    totalFiles: 2,
    totalBytes: 2,
    byType: {},
    duplicates: [],
    files: [
      { path: 'report copy.pdf', name: 'report copy.pdf', ext: '.pdf', size: 1, mtime: 0 },
      { path: 'report final.pdf', name: 'report final.pdf', ext: '.pdf', size: 1, mtime: 0 },
    ],
  }
  const plan = expandStrategy(collide, strategy, '/z', '/trash/x', Date.UTC(2026, 5, 19))
  const dests = plan.operations.filter((o) => o.op === 'move').map((o) => (o.op === 'move' ? o.to : ''))
  expect(new Set(dests).size).toBe(dests.length) // all destinations unique
  expect(dests).toContain('Documents/report.pdf')
  expect(dests).toContain('Documents/report-1.pdf')
})

test('createStrategy parses compact JSON', async () => {
  const client = {
    complete: async () =>
      '```json\n' +
      JSON.stringify({
        summary: 'tidy',
        folders: [{ name: 'Images', accepts: ['image'] }],
        quarantineDuplicates: true,
        quarantineJunk: false,
        renameMessy: true,
      }) +
      '\n```',
  }
  const s = await createStrategy(
    { path: '/z', name: 'Z', totalFiles: 1, totalBytes: 1, byType: {}, approxDuplicateBytes: 0, biggestFiles: [], looseFileCount: 1 },
    client,
  )
  expect(s.folders[0].name).toBe('Images')
})
