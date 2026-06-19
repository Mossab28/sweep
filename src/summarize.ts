import { isJunk } from './categorize.js'
import type { Index, Plan, PlanSummary, SummaryGroup } from './types.js'

export function summarizePlan(plan: Plan, index: Index, now: number): PlanSummary {
  const byFolder = new Map<string, { count: number; exts: Set<string> }>()
  let moveCount = 0
  for (const op of plan.operations) {
    if (op.op === 'move' || op.op === 'rename') {
      moveCount++
      const folder = op.to.includes('/') ? op.to.slice(0, op.to.indexOf('/')) : '(root)'
      const dot = op.to.lastIndexOf('.')
      const ext = dot > op.to.lastIndexOf('/') ? op.to.slice(dot).toLowerCase() : ''
      const g = byFolder.get(folder) ?? { count: 0, exts: new Set<string>() }
      g.count++
      if (ext) g.exts.add(ext)
      byFolder.set(folder, g)
    }
  }
  const groups: SummaryGroup[] = [...byFolder.entries()]
    .map(([folder, g]) => ({ folder, count: g.count, exts: [...g.exts].slice(0, 4) }))
    .sort((a, b) => b.count - a.count)

  // quarantine breakdown: a quarantined path that is in a duplicate group is a
  // duplicate; otherwise classified as junk if the heuristic matches, else junk.
  const dupPaths = new Set<string>()
  for (const grp of index.duplicates) for (const p of grp.paths.slice(1)) dupPaths.add(p)
  const byPath = new Map(index.files.map((f) => [f.path, f]))
  let duplicates = 0
  let junk = 0
  let total = 0
  for (const op of plan.operations) {
    if (op.op !== 'quarantine') continue
    total++
    if (dupPaths.has(op.path)) {
      duplicates++
      continue
    }
    const file = byPath.get(op.path)
    if (file && isJunk(file, now)) junk++
    else junk++ // not a known duplicate → count as junk/clutter
  }

  return {
    moveCount,
    folderCount: groups.filter((g) => g.folder !== '(root)').length,
    groups,
    quarantine: { total, duplicates, junk },
  }
}
