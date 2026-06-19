import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UndoLog } from './types.js'

export function sweepHome(): string {
  return process.env.SWEEP_HOME ?? join(homedir(), '.sweep')
}

export function quarantineDir(timestamp: string): string {
  return join(sweepHome(), 'trash', timestamp)
}

function undoDir(): string {
  return join(sweepHome(), 'undo')
}

export async function saveUndoLog(log: UndoLog): Promise<string> {
  const dir = undoDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${log.timestamp}.json`)
  await writeFile(path, JSON.stringify(log, null, 2))
  return path
}

export async function deleteUndoLog(timestamp: string): Promise<void> {
  try {
    await rm(join(undoDir(), `${timestamp}.json`))
  } catch {
    // already gone — ignore
  }
}

export async function loadLatestUndoLog(): Promise<UndoLog | null> {
  let names: string[]
  try {
    names = (await readdir(undoDir())).filter((n) => n.endsWith('.json'))
  } catch {
    return null
  }
  if (names.length === 0) return null
  names.sort() // ISO-ish timestamps sort lexicographically
  const latest = names[names.length - 1]
  return JSON.parse(await readFile(join(undoDir(), latest), 'utf8')) as UndoLog
}
