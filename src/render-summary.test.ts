import { expect, test } from 'vitest'
import { renderPlanSummary, renderPlanDetail } from './render.js'
import type { Notable, Plan, PlanSummary } from './types.js'

const summary: PlanSummary = {
  moveCount: 492,
  folderCount: 2,
  groups: [
    { folder: 'Documents', count: 312, exts: ['.pdf', '.docx'] },
    { folder: 'Images', count: 180, exts: ['.png', '.jpg'] },
  ],
  quarantine: { total: 89, duplicates: 62, junk: 27 },
}

const notable: Notable = {
  sensitive: [{ path: 'npm_recovery_codes.txt', name: 'npm_recovery_codes.txt', ext: '.txt', size: 1, mtime: 0 }],
  renames: [{ from: 'mt05-p24-final.pdf', to: 'Documents/mt05-p24.pdf' }],
  keptCount: 0,
}

test('summary shows groups, counts, quarantine split and sensitive callout', () => {
  const out = renderPlanSummary(summary, notable)
  expect(out).toMatch(/Documents/)
  expect(out).toMatch(/312/)
  expect(out).toMatch(/62 duplicate/i)
  expect(out).toMatch(/27/)
  expect(out).toMatch(/npm_recovery_codes\.txt/)
})

test('detail lists operations and truncates long groups', () => {
  const ops = Array.from({ length: 30 }, (_, i) => ({ op: 'move' as const, from: `f${i}.png`, to: `Images/f${i}.png` }))
  const plan: Plan = { summary: 's', operations: ops }
  const out = renderPlanDetail(plan)
  expect(out).toMatch(/Images/)
  expect(out).toMatch(/more/) // truncated with "…N more"
})
