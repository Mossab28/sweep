import { resolve } from 'node:path'
import { z } from 'zod'
import { isInside } from './safety.js'
import type { Plan } from './types.js'

const OperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('mkdir'), path: z.string().min(1) }),
  z.object({ op: z.literal('move'), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ op: z.literal('rename'), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ op: z.literal('quarantine'), path: z.string().min(1) }),
])

export const PlanSchema = z.object({
  summary: z.string(),
  operations: z.array(OperationSchema),
})

export function parsePlan(json: string): Plan {
  const data = JSON.parse(json)
  return PlanSchema.parse(data)
}

/** absolute-resolve a plan-relative path under the target */
function under(targetAbs: string, rel: string): string {
  return resolve(targetAbs, rel)
}

export function assertPlanWithinBounds(plan: Plan, targetAbs: string, quarantineAbs: string): void {
  for (const op of plan.operations) {
    const paths: string[] = []
    if (op.op === 'mkdir' || op.op === 'quarantine') paths.push(under(targetAbs, op.path))
    if (op.op === 'move' || op.op === 'rename') {
      paths.push(under(targetAbs, op.from), under(targetAbs, op.to))
    }
    for (const p of paths) {
      const ok = isInside(p, targetAbs) || isInside(p, quarantineAbs)
      if (!ok) {
        throw new Error(`Operation ${op.op} resolves outside the target: ${p}`)
      }
    }
  }
}
