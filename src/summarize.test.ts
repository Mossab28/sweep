import { expect, test } from 'vitest'
import { summarizePlan } from './summarize.js'
import type { Index, Plan } from './types.js'

const index: Index = {
  root: '/z',
  totalFiles: 4,
  totalBytes: 4,
  byType: {},
  duplicates: [{ hash: 'h', size: 1, paths: ['a.png', 'b.png'] }],
  files: [
    { path: 'a.png', name: 'a.png', ext: '.png', size: 1, mtime: 0, hash: 'h' },
    { path: 'b.png', name: 'b.png', ext: '.png', size: 1, mtime: 0, hash: 'h' },
    { path: 'doc.pdf', name: 'doc.pdf', ext: '.pdf', size: 1, mtime: 0 },
    { path: 'old.dmg', name: 'old.dmg', ext: '.dmg', size: 1, mtime: 0 },
  ],
}

const plan: Plan = {
  summary: 's',
  operations: [
    { op: 'mkdir', path: 'Images' },
    { op: 'mkdir', path: 'Documents' },
    { op: 'move', from: 'a.png', to: 'Images/a.png' },
    { op: 'move', from: 'doc.pdf', to: 'Documents/doc.pdf' },
    { op: 'quarantine', path: 'b.png' }, // duplicate of a.png
    { op: 'quarantine', path: 'old.dmg' }, // junk (old installer)
  ],
}

test('groups moves by destination folder with counts and exts', () => {
  const s = summarizePlan(plan, index, Date.UTC(2026, 5, 19))
  expect(s.moveCount).toBe(2)
  expect(s.folderCount).toBe(2)
  const images = s.groups.find((g) => g.folder === 'Images')!
  expect(images.count).toBe(1)
  expect(images.exts).toContain('.png')
})

test('splits quarantine into duplicates and junk', () => {
  const s = summarizePlan(plan, index, Date.UTC(2026, 5, 19))
  expect(s.quarantine.total).toBe(2)
  expect(s.quarantine.duplicates).toBe(1) // b.png
  expect(s.quarantine.junk).toBe(1) // old.dmg
})
