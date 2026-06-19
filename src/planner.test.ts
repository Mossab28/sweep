import { expect, test } from 'vitest'
import { createPlan, stripFences } from './planner.js'
import type { Index } from './types.js'

const index: Index = {
  root: '/tmp/target',
  totalFiles: 1,
  totalBytes: 5,
  byType: { '.png': { count: 1, bytes: 5 } },
  duplicates: [],
  files: [{ path: 'a.png', name: 'a.png', ext: '.png', size: 5, mtime: 0 }],
}

test('returns a validated plan from the client response', async () => {
  const client = {
    complete: async () =>
      JSON.stringify({
        summary: 'tidy',
        operations: [
          { op: 'mkdir', path: 'images' },
          { op: 'move', from: 'a.png', to: 'images/a.png' },
        ],
      }),
  }
  const plan = await createPlan(index, { mode: 'organize' }, '/tmp/target', '/tmp/.sweep/trash/x', client)
  expect(plan.summary).toBe('tidy')
  expect(plan.operations).toHaveLength(2)
})

test('rejects with friendly error when client returns non-JSON', async () => {
  const client = {
    complete: async () => "sorry, I can't help with that",
  }
  await expect(
    createPlan(index, { mode: 'organize' }, '/tmp/target', '/tmp/.sweep/trash/x', client),
  ).rejects.toThrow(/valid plan/i)
})

test('stripFences removes a ```json fence and leaves bare JSON untouched', () => {
  expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  expect(stripFences('{"a":1}')).toBe('{"a":1}')
})

test('accepts a plan even when the client wraps it in a markdown fence', async () => {
  const client = {
    complete: async () =>
      '```json\n' +
      JSON.stringify({ summary: 'tidy', operations: [{ op: 'mkdir', path: 'images' }] }) +
      '\n```',
  }
  const plan = await createPlan(index, { mode: 'organize' }, '/tmp/target', '/tmp/.sweep/trash/x', client)
  expect(plan.operations).toHaveLength(1)
})

test('rejects an out-of-bounds plan from the model', async () => {
  const client = {
    complete: async () =>
      JSON.stringify({ summary: 'x', operations: [{ op: 'move', from: 'a.png', to: '../escape' }] }),
  }
  await expect(
    createPlan(index, { mode: 'organize' }, '/tmp/target', '/tmp/.sweep/trash/x', client),
  ).rejects.toThrow(/outside/i)
})
