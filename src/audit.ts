import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, relative, sep } from 'node:path'
import { isExcluded } from './safety.js'
import type { Audit, BigFile, OverviewItem, ZoneStat } from './types.js'

export const DEFAULT_ZONE_NAMES = ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Movies', 'Music']

interface Acc {
  files: number
  bytes: number
  byType: ZoneStat['byType']
  bySize: Map<number, number>
  biggest: BigFile[]
  loose: number
}

async function walk(root: string, dir: string, acc: Acc, depth: number): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // unreadable — skip silently
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    const rel = relative(root, abs).split(sep).join('/')
    if (isExcluded(rel) || entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      await walk(root, abs, acc, depth + 1)
    } else if (entry.isFile()) {
      let s
      try {
        s = await stat(abs)
      } catch {
        continue
      }
      acc.files++
      acc.bytes += s.size
      if (depth === 0) acc.loose++
      const key = extname(entry.name).toLowerCase() || '(none)'
      acc.byType[key] ??= { count: 0, bytes: 0 }
      acc.byType[key].count++
      acc.byType[key].bytes += s.size
      acc.bySize.set(s.size, (acc.bySize.get(s.size) ?? 0) + 1)
      acc.biggest.push({ path: rel, bytes: s.size })
    }
  }
}

export async function zoneStat(zonePath: string, name: string): Promise<ZoneStat | null> {
  try {
    if (!(await stat(zonePath)).isDirectory()) return null
  } catch {
    return null
  }
  const acc: Acc = { files: 0, bytes: 0, byType: {}, bySize: new Map(), biggest: [], loose: 0 }
  await walk(zonePath, zonePath, acc, 0)
  let approxDuplicateBytes = 0
  for (const [size, count] of acc.bySize) {
    if (count > 1) approxDuplicateBytes += (count - 1) * size
  }
  acc.biggest.sort((a, b) => b.bytes - a.bytes)
  return {
    path: zonePath,
    name,
    totalFiles: acc.files,
    totalBytes: acc.bytes,
    byType: acc.byType,
    approxDuplicateBytes,
    biggestFiles: acc.biggest.slice(0, 5),
    looseFileCount: acc.loose,
  }
}

export async function auditHome(home: string): Promise<Audit> {
  const zones: ZoneStat[] = []
  for (const name of DEFAULT_ZONE_NAMES) {
    const z = await zoneStat(join(home, name), name)
    if (z) zones.push(z)
  }
  // loose files directly under ~ (depth 0 only) as a pseudo-zone
  const looseAcc: Acc = { files: 0, bytes: 0, byType: {}, bySize: new Map(), biggest: [], loose: 0 }
  try {
    const entries = await readdir(home, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue
      const s = await stat(join(home, entry.name)).catch(() => null)
      if (!s) continue
      looseAcc.files++
      looseAcc.bytes += s.size
      looseAcc.loose++
      looseAcc.biggest.push({ path: entry.name, bytes: s.size })
    }
  } catch {
    /* ignore */
  }
  if (looseAcc.files > 0) {
    looseAcc.biggest.sort((a, b) => b.bytes - a.bytes)
    zones.push({
      path: home,
      name: 'Home (loose files)',
      totalFiles: looseAcc.files,
      totalBytes: looseAcc.bytes,
      byType: looseAcc.byType,
      approxDuplicateBytes: 0,
      biggestFiles: looseAcc.biggest.slice(0, 5),
      looseFileCount: looseAcc.loose,
    })
  }
  // Overview is intentionally left empty in v2: deep-walking ~/Library or
  // /Applications would dominate audit time. Zone sizes already cover the
  // actionable picture. (Cheap overview is future scope.)
  const overview: OverviewItem[] = []
  const scannedBytes = zones.reduce((n, z) => n + z.totalBytes, 0)
  return { home, zones, overview, scannedBytes }
}

export function defaultHome(): string {
  return process.env.SWEEP_HOME ?? homedir()
}
