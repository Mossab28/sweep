import type { FileEntry, Index } from './types.js'

const PATTERNS: RegExp[] = [
  /(^|[^a-z])\.env($|\.)/i, // .env, .env.local
  /recovery[\s_-]*codes?/i,
  /backup[\s_-]*codes?/i,
  /\bid_(rsa|ed25519|ecdsa|dsa)\b/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /\b(secret|secrets|credential|credentials|password|passwd)\b/i,
  /\b(seed[\s_-]*phrase|mnemonic|wallet)\b/i,
  /\b(api[\s_-]*key|private[\s_-]*key)\b/i,
]

export function isSensitive(name: string): boolean {
  return PATTERNS.some((re) => re.test(name))
}

export function findSensitive(index: Index): FileEntry[] {
  return index.files.filter((f) => isSensitive(f.name))
}
