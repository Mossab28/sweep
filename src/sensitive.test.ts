import { expect, test } from 'vitest'
import { isSensitive, findSensitive } from './sensitive.js'
import type { Index } from './types.js'

test('flags secret-looking filenames', () => {
  expect(isSensitive('npm_recovery_codes.txt')).toBe(true)
  expect(isSensitive('.env')).toBe(true)
  expect(isSensitive('.env.local')).toBe(true)
  expect(isSensitive('id_rsa')).toBe(true)
  expect(isSensitive('server.key')).toBe(true)
  expect(isSensitive('aws-credentials.json')).toBe(true)
  expect(isSensitive('wallet-seed-phrase.txt')).toBe(true)
  expect(isSensitive('backup_codes.txt')).toBe(true)
})

test('does not flag ordinary files', () => {
  expect(isSensitive('report.pdf')).toBe(false)
  expect(isSensitive('cat.png')).toBe(false)
  expect(isSensitive('environment-study.docx')).toBe(false) // not ".env"
})

test('findSensitive returns the matching entries', () => {
  const index: Index = {
    root: '/z',
    totalFiles: 2,
    totalBytes: 2,
    byType: {},
    duplicates: [],
    files: [
      { path: '.env', name: '.env', ext: '', size: 1, mtime: 0 },
      { path: 'a.pdf', name: 'a.pdf', ext: '.pdf', size: 1, mtime: 0 },
    ],
  }
  expect(findSensitive(index).map((f) => f.name)).toEqual(['.env'])
})
