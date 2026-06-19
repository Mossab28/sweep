import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { isExcluded } from './safety.js'
import type { DuplicateGroup, FileEntry, Index } from './types.js'

async function hashFile(absPath: string): Promise<string> {
  // partial hash: first 64KB is enough to group duplicates cheaply
  const buf = await readFile(absPath)
  const slice = buf.subarray(0, 64 * 1024)
  return createHash('sha1').update(slice).digest('hex')
}

async function walk(root: string, dir: string, out: FileEntry[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    const rel = relative(root, abs).split(sep).join('/')
    if (isExcluded(rel)) continue
    if (entry.isDirectory()) {
      await walk(root, abs, out)
    } else if (entry.isFile()) {
      const s = await stat(abs)
      out.push({
        path: rel,
        name: entry.name,
        ext: extname(entry.name).toLowerCase(),
        size: s.size,
        mtime: s.mtimeMs,
      })
    }
  }
}

export async function scan(root: string): Promise<Index> {
  const files: FileEntry[] = []
  await walk(root, root, files)

  const byType: Index['byType'] = {}
  let totalBytes = 0
  for (const f of files) {
    totalBytes += f.size
    const key = f.ext || '(none)'
    byType[key] ??= { count: 0, bytes: 0 }
    byType[key].count++
    byType[key].bytes += f.size
  }

  // duplicate detection: hash only files whose size collides with another
  const bySize = new Map<number, FileEntry[]>()
  for (const f of files) {
    const arr = bySize.get(f.size) ?? []
    arr.push(f)
    bySize.set(f.size, arr)
  }
  const byHash = new Map<string, FileEntry[]>()
  for (const [, group] of bySize) {
    if (group.length < 2) continue
    for (const f of group) {
      f.hash = await hashFile(join(root, ...f.path.split('/')))
      const arr = byHash.get(f.hash) ?? []
      arr.push(f)
      byHash.set(f.hash, arr)
    }
  }
  const duplicates: DuplicateGroup[] = []
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue
    duplicates.push({ hash, size: group[0].size, paths: group.map((f) => f.path).sort() })
  }

  return {
    root,
    totalFiles: files.length,
    totalBytes,
    byType,
    duplicates,
    files,
  }
}
