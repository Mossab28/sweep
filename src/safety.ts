import { homedir } from 'node:os'
import { relative, resolve, sep } from 'node:path'

export const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.cache',
  'Library',
  'System',
  '.Trash',
  '$RECYCLE.BIN',
]

const FORBIDDEN_ROOTS = new Set([sep, resolve(homedir())])

export function assertScannableTarget(absPath: string): void {
  const p = resolve(absPath)
  if (FORBIDDEN_ROOTS.has(p)) {
    throw new Error(
      `sweep refuses to operate on "${p}" — point it at a specific folder (e.g. ~/Downloads).`,
    )
  }
}

export function isExcluded(relPath: string): boolean {
  const segments = relPath.split(/[\\/]/)
  return segments.some((s) => DEFAULT_EXCLUDES.includes(s))
}

export function isInside(childAbs: string, parentAbs: string): boolean {
  const rel = relative(resolve(parentAbs), resolve(childAbs))
  return rel.length > 0 && !rel.startsWith('..') && !rel.startsWith(sep)
}
