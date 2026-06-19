import { expect, test } from 'vitest'
import { buildReportPrompt, createReport } from './report.js'
import type { Audit } from './types.js'

const audit: Audit = {
  home: '/Users/x',
  zones: [
    {
      path: '/Users/x/Downloads',
      name: 'Downloads',
      totalFiles: 760,
      totalBytes: 1_600_000_000,
      byType: { '.png': { count: 300, bytes: 500 } },
      approxDuplicateBytes: 200_000_000,
      biggestFiles: [{ path: 'big.mov', bytes: 900_000_000 }],
      looseFileCount: 700,
    },
  ],
  overview: [{ label: '~/Library', bytes: 5_000_000_000 }],
  scannedBytes: 1_600_000_000,
}

test('prompt embeds zone names and asks for JSON', () => {
  const p = buildReportPrompt(audit)
  expect(p).toContain('Downloads')
  expect(p).toContain('JSON')
})

test('createReport parses a ranked report', async () => {
  const client = {
    complete: async () =>
      JSON.stringify({
        summary: 'Downloads is the worst offender.',
        zones: [
          {
            path: '/Users/x/Downloads',
            title: 'Downloads',
            reason: '1.6 GB, 760 files, ~200 MB duplicates',
            priority: 1,
            reclaimableHint: '~200 MB',
          },
        ],
      }),
  }
  const report = await createReport(audit, client)
  expect(report.zones[0].path).toBe('/Users/x/Downloads')
  expect(report.zones[0].priority).toBe(1)
})

test('createReport rejects malformed output', async () => {
  await expect(createReport(audit, { complete: async () => 'nope' })).rejects.toThrow(/valid report/i)
})
