import { z } from 'zod'
import { stripFences, type PlanClient } from './planner.js'
import type { Audit, Report } from './types.js'

const ReportSchema = z.object({
  summary: z.string(),
  zones: z.array(
    z.object({
      path: z.string().min(1),
      title: z.string(),
      reason: z.string(),
      priority: z.number(),
      reclaimableHint: z.string().optional(),
    }),
  ),
})

function mb(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

export function buildReportPrompt(audit: Audit): string {
  const zones = audit.zones
    .map(
      (z) =>
        `- path: ${z.path}\n  name: ${z.name}\n  files: ${z.totalFiles}\n  size: ${mb(z.totalBytes)}\n  loose_at_root: ${z.looseFileCount}\n  approx_duplicate: ${mb(z.approxDuplicateBytes)}\n  biggest: ${z.biggestFiles.map((b) => `${b.path} (${mb(b.bytes)})`).join(', ')}`,
    )
    .join('\n')
  const overview = audit.overview.map((o) => `- ${o.label}: ${mb(o.bytes)}`).join('\n')
  return [
    "You are sweep, auditing a user's computer. Below are read-only stats for their content folders.",
    `Tidyable zones:\n${zones}`,
    `Disk overview (read-only, not tidyable):\n${overview || '(none)'}`,
    '',
    'Write a short report and RANK the tidyable zones worst-first (1 = worst).',
    'Respond with ONLY a JSON object (no prose, no markdown fences):',
    '{"summary": string, "zones": [{"path": string, "title": string, "reason": string, "priority": number, "reclaimableHint"?: string}]}',
    'Use the exact `path` values from the zones above. Keep each reason to one line.',
  ].join('\n')
}

export async function createReport(audit: Audit, client: PlanClient): Promise<Report> {
  const raw = await client.complete(buildReportPrompt(audit))
  try {
    return ReportSchema.parse(JSON.parse(stripFences(raw)))
  } catch {
    throw new Error('Claude did not return a valid report (expected JSON). Please try again.')
  }
}
