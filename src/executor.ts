import { mkdir, rename, rmdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { AppliedOp, Plan, UndoLog } from './types.js'

function abs(target: string, rel: string): string {
  return resolve(target, rel)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export async function execute(
  plan: Plan,
  target: string,
  quarantine: string,
  timestamp: string,
): Promise<UndoLog> {
  // Pre-flight: collect all destinations and check for collisions / existing files
  const destinations = new Set<string>()
  for (const op of plan.operations) {
    if (op.op === 'move' || op.op === 'rename') {
      const to = abs(target, op.to)
      if (destinations.has(to)) {
        throw new Error(`Plan has conflicting destinations: ${to}`)
      }
      destinations.add(to)
      if (await pathExists(to)) {
        throw new Error(`Destination already exists: ${to}`)
      }
    } else if (op.op === 'quarantine') {
      const to = join(quarantine, op.path)
      if (destinations.has(to)) {
        throw new Error(`Plan has conflicting destinations: ${to}`)
      }
      destinations.add(to)
      if (await pathExists(to)) {
        throw new Error(`Destination already exists: ${to}`)
      }
    }
  }

  const applied: AppliedOp[] = []
  await mkdir(quarantine, { recursive: true })

  for (const op of plan.operations) {
    if (op.op === 'mkdir') {
      const dir = abs(target, op.path)
      await mkdir(dir, { recursive: true })
      applied.push({ op: 'rmdir', path: dir })
    } else if (op.op === 'move' || op.op === 'rename') {
      const from = abs(target, op.from)
      const to = abs(target, op.to)
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
      applied.push({ op: 'move', from: to, to: from }) // inverse
    } else if (op.op === 'quarantine') {
      const from = abs(target, op.path)
      const to = join(quarantine, op.path)
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
      applied.push({ op: 'restore', from: to, to: from })
    }
  }

  return { timestamp, target, applied }
}

export async function applyUndo(log: UndoLog): Promise<void> {
  // reverse order so nested mkdirs/moves unwind correctly
  for (const op of [...log.applied].reverse()) {
    if (op.op === 'rmdir') {
      try {
        await rmdir(op.path)
      } catch {
        // directory not empty or already gone — leave it in place
      }
    } else if (op.op === 'move' || op.op === 'restore') {
      await mkdir(dirname(op.to), { recursive: true })
      await rename(op.from, op.to)
    }
  }
}
