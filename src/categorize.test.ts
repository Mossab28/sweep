import { expect, test } from 'vitest'
import { extToCategory, isJunk, isMessyName, tidyName } from './categorize.js'
import type { FileEntry } from './types.js'

test('maps extensions to categories', () => {
  expect(extToCategory('.png')).toBe('image')
  expect(extToCategory('.jpeg')).toBe('image')
  expect(extToCategory('.mp4')).toBe('video')
  expect(extToCategory('.mp3')).toBe('audio')
  expect(extToCategory('.pdf')).toBe('document')
  expect(extToCategory('.zip')).toBe('archive')
  expect(extToCategory('.dmg')).toBe('installer')
  expect(extToCategory('.ts')).toBe('code')
  expect(extToCategory('.csv')).toBe('data')
  expect(extToCategory('.xyz')).toBe('other')
  expect(extToCategory('')).toBe('other')
})

const file = (over: Partial<FileEntry>): FileEntry => ({
  path: 'x',
  name: 'x',
  ext: '',
  size: 1,
  mtime: 0,
  ...over,
})

test('flags temp cruft and old installers as junk', () => {
  const now = Date.UTC(2026, 5, 19)
  const old = now - 60 * 24 * 3600 * 1000
  expect(isJunk(file({ name: '.DS_Store' }), now)).toBe(true)
  expect(isJunk(file({ name: 'a.tmp', ext: '.tmp' }), now)).toBe(true)
  expect(isJunk(file({ name: 'old.dmg', ext: '.dmg', mtime: old }), now)).toBe(true)
  expect(isJunk(file({ name: 'new.dmg', ext: '.dmg', mtime: now }), now)).toBe(false)
  expect(isJunk(file({ name: 'keep.pdf', ext: '.pdf', mtime: old }), now)).toBe(false)
})

test('detects and tidies messy names', () => {
  expect(isMessyName('IMG 2024 copy.png')).toBe(true)
  expect(isMessyName('report-FINAL-final.docx')).toBe(true)
  expect(isMessyName('notes.txt')).toBe(false)
  expect(tidyName('report-FINAL-final.docx')).toBe('report.docx')
  expect(tidyName('IMG 2024 copy.png')).toBe('img-2024.png')
})
