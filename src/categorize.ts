import { extname } from 'node:path'
import type { Category, FileEntry } from './types.js'

const MAP: Record<string, Category> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image',
  '.webp': 'image', '.heic': 'image', '.tiff': 'image', '.bmp': 'image', '.svg': 'image',
  '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video', '.webm': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.aac': 'audio', '.m4a': 'audio',
  '.pdf': 'document', '.doc': 'document', '.docx': 'document', '.txt': 'document',
  '.rtf': 'document', '.pages': 'document', '.key': 'document', '.ppt': 'document',
  '.pptx': 'document', '.md': 'document',
  '.zip': 'archive', '.tar': 'archive', '.gz': 'archive', '.rar': 'archive', '.7z': 'archive',
  '.dmg': 'installer', '.pkg': 'installer', '.exe': 'installer', '.msi': 'installer', '.deb': 'installer',
  '.ts': 'code', '.js': 'code', '.py': 'code', '.go': 'code', '.rs': 'code',
  '.java': 'code', '.c': 'code', '.cpp': 'code', '.sh': 'code', '.json': 'code', '.html': 'code', '.css': 'code',
  '.csv': 'data', '.xlsx': 'data', '.xls': 'data', '.tsv': 'data', '.xml': 'data', '.sqlite': 'data',
}

export function extToCategory(ext: string): Category {
  return MAP[ext.toLowerCase()] ?? 'other'
}

const TEMP_EXTS = new Set(['.tmp', '.temp', '.crdownload', '.part', '.log'])
const CRUFT_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])
const THIRTY_DAYS = 30 * 24 * 3600 * 1000

export function isJunk(file: FileEntry, now: number): boolean {
  const lower = file.name.toLowerCase()
  if (CRUFT_NAMES.has(lower)) return true
  if (TEMP_EXTS.has(file.ext.toLowerCase())) return true
  if (extToCategory(file.ext) === 'installer' && now - file.mtime > THIRTY_DAYS) return true
  return false
}

const MESSY = /\s|__|-(?:final|copy|FINAL|COPY)\b|\bcopy\b|FINAL-final/i

export function isMessyName(name: string): boolean {
  const base = name.slice(0, name.length - extname(name).length)
  return MESSY.test(name) || /\s/.test(base) || /(final|copy)/i.test(base) && /[-_ ].*(final|copy)/i.test(base)
}

export function tidyName(name: string): string {
  const ext = extname(name)
  let base = name.slice(0, name.length - ext.length)
  base = base
    .replace(/[-_ ]*(final|copy)\b/gi, '')
    .replace(/\bfinal\b/gi, '')
    .replace(/\bcopy\b/gi, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return (base || 'file') + ext.toLowerCase()
}
