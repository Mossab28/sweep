import { expect, test } from 'vitest'
import { menuHint, renderReport } from './render.js'
import type { Report } from './types.js'

const report: Report = {
  summary: 'Downloads is the worst.',
  zones: [
    { path: '/x/Pictures', title: 'Pictures', reason: '3 GB, messy', priority: 2 },
    { path: '/x/Downloads', title: 'Downloads', reason: '1.6 GB, dupes', priority: 1 },
  ],
}

test('renders zones numbered, worst-first, with reasons', () => {
  const out = renderReport(report)
  const iDownloads = out.indexOf('Downloads')
  const iPictures = out.indexOf('Pictures')
  expect(iDownloads).toBeGreaterThan(-1)
  expect(iDownloads).toBeLessThan(iPictures) // priority 1 listed before 2
  expect(out).toContain('1.6 GB, dupes')
  expect(out).toMatch(/1[).]/) // numbered
})

test('menuHint mentions the keys', () => {
  expect(menuHint()).toMatch(/A/)
  expect(menuHint()).toMatch(/Q/i)
})
