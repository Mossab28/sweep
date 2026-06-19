import { expect, test } from 'vitest'
import { renderPlan } from './render.js'
import type { Plan } from './types.js'

test('renders summary, operations and a counts footer', () => {
  const plan: Plan = {
    summary: 'Organize into folders',
    operations: [
      { op: 'mkdir', path: 'images' },
      { op: 'move', from: 'a.png', to: 'images/a.png' },
      { op: 'quarantine', path: 'dup.png' },
    ],
  }
  const out = renderPlan(plan)
  expect(out).toContain('Organize into folders')
  expect(out).toContain('images/a.png')
  expect(out).toMatch(/1 move/)
  expect(out).toMatch(/1 new folder/)
  expect(out).toMatch(/1 quarantined/)
})
