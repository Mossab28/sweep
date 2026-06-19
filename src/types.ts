export interface FileEntry {
  /** path relative to the scanned root, POSIX-style */
  path: string
  name: string
  ext: string
  size: number
  /** modified time, ms since epoch */
  mtime: number
  /** partial content hash, present only for files that have a duplicate */
  hash?: string
}

export interface DuplicateGroup {
  hash: string
  size: number
  /** relative paths sharing identical content */
  paths: string[]
}

export interface Index {
  /** absolute path of the scanned root */
  root: string
  totalFiles: number
  totalBytes: number
  byType: Record<string, { count: number; bytes: number }>
  duplicates: DuplicateGroup[]
  files: FileEntry[]
}

export type IntentMode = 'clean' | 'organize' | 'custom'
export interface Intent {
  mode: IntentMode
  /** required when mode === 'custom' */
  instruction?: string
}

export type Operation =
  | { op: 'mkdir'; path: string }
  | { op: 'move'; from: string; to: string }
  | { op: 'rename'; from: string; to: string }
  | { op: 'quarantine'; path: string }

export interface Plan {
  summary: string
  operations: Operation[]
}

/** the inverse of an executed operation, used by undo */
export type AppliedOp =
  | { op: 'rmdir'; path: string }
  | { op: 'move'; from: string; to: string }
  | { op: 'restore'; from: string; to: string }

export interface UndoLog {
  timestamp: string
  target: string
  applied: AppliedOp[]
}
