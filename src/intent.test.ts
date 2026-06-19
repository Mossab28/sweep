import { expect, test } from 'vitest'
import { buildPrompt } from './intent.js'
import type { Index } from './types.js'

const index: Index = {
  root: '/tmp/x',
  totalFiles: 2,
  totalBytes: 10,
  byType: { '.png': { count: 1, bytes: 5 }, '.txt': { count: 1, bytes: 5 } },
  duplicates: [],
  files: [
    { path: 'a.png', name: 'a.png', ext: '.png', size: 5, mtime: 0 },
    { path: 'note.txt', name: 'note.txt', ext: '.txt', size: 5, mtime: 0 },
  ],
}

test('organize prompt mentions organizing and asks for JSON', () => {
  const p = buildPrompt(index, { mode: 'organize' })
  expect(p.toLowerCase()).toContain('organize')
  expect(p).toContain('JSON')
  expect(p).toContain('a.png')
})

test('custom prompt embeds the user instruction', () => {
  const p = buildPrompt(index, { mode: 'custom', instruction: 'sort photos by year' })
  expect(p).toContain('sort photos by year')
})
