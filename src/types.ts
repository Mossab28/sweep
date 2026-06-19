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

export type Category =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'installer'
  | 'code'
  | 'data'
  | 'other'

export interface BigFile {
  /** path relative to the zone root, POSIX-style */
  path: string
  bytes: number
}

export interface ZoneStat {
  /** absolute path of the zone */
  path: string
  /** display name, e.g. "Downloads" */
  name: string
  totalFiles: number
  totalBytes: number
  byType: Record<string, { count: number; bytes: number }>
  /** bytes that appear to be duplicated (same size), a cheap approximation */
  approxDuplicateBytes: number
  /** largest files in the zone, biggest first, capped */
  biggestFiles: BigFile[]
  /** files sitting directly in the zone root (not in a subfolder) */
  looseFileCount: number
}

export interface OverviewItem {
  label: string
  bytes: number
}

export interface Audit {
  /** absolute home directory the audit was run for */
  home: string
  zones: ZoneStat[]
  /** coarse read-only "where the gigabytes are" consumers */
  overview: OverviewItem[]
  /** total bytes counted across scanned zones */
  scannedBytes: number
}

export interface TargetFolder {
  name: string
  accepts: Category[]
}

export interface Strategy {
  summary: string
  folders: TargetFolder[]
  quarantineDuplicates: boolean
  quarantineJunk: boolean
  renameMessy: boolean
  /** filename substrings to leave untouched (e.g. ["screenshot"]) */
  keep?: string[]
}

export interface ReportZone {
  /** absolute path of a tidyable zone */
  path: string
  title: string
  reason: string
  /** 1 = highest priority (worst), larger = lower priority */
  priority: number
  reclaimableHint?: string
}

export interface Report {
  summary: string
  zones: ReportZone[]
}

export interface SummaryGroup {
  /** destination top folder, e.g. "Documents" */
  folder: string
  count: number
  /** a few representative extensions, e.g. [".pdf", ".docx"] */
  exts: string[]
}

export interface QuarantineBreakdown {
  total: number
  duplicates: number
  junk: number
}

export interface PlanSummary {
  moveCount: number
  folderCount: number
  groups: SummaryGroup[]
  quarantine: QuarantineBreakdown
}

export interface Rename {
  from: string
  to: string
}

export interface Notable {
  /** sensitive files left untouched */
  sensitive: FileEntry[]
  /** files whose name was tidied during a move */
  renames: Rename[]
  /** count of files left in place because of a `keep` rule */
  keptCount: number
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
}
