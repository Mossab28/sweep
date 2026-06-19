import { z } from 'zod'
import { extToCategory, isJunk, isMessyName, tidyName } from './categorize.js'
import { stripFences, type PlanClient } from './planner.js'
import { assertPlanWithinBounds } from './schema.js'
import type { Index, Operation, Plan, Strategy, ZoneStat } from './types.js'

const CATEGORIES = [
  'image', 'video', 'audio', 'document', 'archive', 'installer', 'code', 'data', 'other',
] as const

const StrategySchema = z.object({
  summary: z.string(),
  folders: z.array(z.object({ name: z.string().min(1), accepts: z.array(z.enum(CATEGORIES)) })),
  quarantineDuplicates: z.boolean(),
  quarantineJunk: z.boolean(),
  renameMessy: z.boolean(),
})

export function buildStrategyPrompt(zone: ZoneStat): string {
  const types = Object.entries(zone.byType)
    .map(([ext, v]) => `${ext}: ${v.count}`)
    .join(', ')
  return [
    `You are sweep, planning how to tidy the folder "${zone.name}" (${zone.path}).`,
    `It has ${zone.totalFiles} files. Types: ${types || '(none)'}.`,
    'Choose a small set of destination folders and which file categories each accepts.',
    `Categories: ${CATEGORIES.join(', ')}.`,
    'Respond with ONLY a JSON object (no prose, no markdown fences):',
    '{"summary": string, "folders": [{"name": string, "accepts": Category[]}], "quarantineDuplicates": boolean, "quarantineJunk": boolean, "renameMessy": boolean}',
  ].join('\n')
}

export async function createStrategy(zone: ZoneStat, client: PlanClient): Promise<Strategy> {
  const raw = await client.complete(buildStrategyPrompt(zone))
  try {
    return StrategySchema.parse(JSON.parse(stripFences(raw)))
  } catch {
    throw new Error('Claude did not return a valid strategy (expected JSON). Please try again.')
  }
}

export function expandStrategy(
  index: Index,
  strategy: Strategy,
  target: string,
  quarantine: string,
  now: number,
  existing: Set<string> = new Set(),
): Plan {
  const ops: Operation[] = []
  const createdFolders = new Set<string>()
  const usedDest = new Set<string>()

  // pick a destination path that doesn't collide with an earlier move target or an on-disk file
  const uniqueDest = (dir: string, name: string): string => {
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = `${dir}/${name}`
    let i = 1
    while (usedDest.has(candidate) || existing.has(candidate)) {
      candidate = `${dir}/${base}-${i}${ext}`
      i++
    }
    usedDest.add(candidate)
    return candidate
  }

  // duplicates: keep the first path of each group, quarantine the rest
  const quarantined = new Set<string>()
  if (strategy.quarantineDuplicates) {
    for (const group of index.duplicates) {
      for (const p of group.paths.slice(1)) {
        ops.push({ op: 'quarantine', path: p })
        quarantined.add(p)
      }
    }
  }

  for (const file of index.files) {
    if (quarantined.has(file.path)) continue
    if (strategy.quarantineJunk && isJunk(file, now)) {
      ops.push({ op: 'quarantine', path: file.path })
      continue
    }
    const category = extToCategory(file.ext)
    const folder = strategy.folders.find((f) => f.accepts.includes(category))
    if (!folder) continue // leave files we have nowhere to put
    if (!createdFolders.has(folder.name)) {
      ops.push({ op: 'mkdir', path: folder.name })
      createdFolders.add(folder.name)
    }
    const name = strategy.renameMessy && isMessyName(file.name) ? tidyName(file.name) : file.name
    ops.push({ op: 'move', from: file.path, to: uniqueDest(folder.name, name) })
  }

  // ensure mkdir precedes the first move into it (folders were created on demand above)
  const plan: Plan = { summary: strategy.summary, operations: ops }
  assertPlanWithinBounds(plan, target, quarantine)
  return plan
}
