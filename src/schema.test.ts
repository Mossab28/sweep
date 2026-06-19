import { join } from 'node:path'
import { expect, test } from 'vitest'
import { assertPlanWithinBounds, parsePlan } from './schema.js'

const TARGET = '/tmp/target'
const TRASH = '/tmp/.sweep/trash/x'

test('parses a valid plan', () => {
  const plan = parsePlan(
    JSON.stringify({
      summary: 'tidy',
      operations: [
        { op: 'mkdir', path: 'images' },
        { op: 'move', from: 'a.png', to: 'images/a.png' },
        { op: 'quarantine', path: 'dup.png' },
      ],
    }),
  )
  expect(plan.operations).toHaveLength(3)
})

test('rejects malformed json', () => {
  expect(() => parsePlan('not json')).toThrow()
})

test('rejects unknown op kinds', () => {
  expect(() => parsePlan(JSON.stringify({ summary: 's', operations: [{ op: 'rm', path: 'x' }] }))).toThrow()
})

test('rejects operations escaping the target', () => {
  const plan = parsePlan(
    JSON.stringify({ summary: 's', operations: [{ op: 'move', from: 'a', to: '../evil' }] }),
  )
  expect(() => assertPlanWithinBounds(plan, TARGET, TRASH)).toThrow(/outside/i)
})

test('accepts in-bounds operations', () => {
  const plan = parsePlan(
    JSON.stringify({ summary: 's', operations: [{ op: 'move', from: 'a', to: 'sub/a' }] }),
  )
  expect(() => assertPlanWithinBounds(plan, TARGET, TRASH)).not.toThrow()
  expect(join(TARGET, 'sub/a')).toContain('target')
})
