import { homedir } from 'node:os'
import { sep } from 'node:path'
import { expect, test } from 'vitest'
import { assertScannableTarget, isExcluded, isInside } from './safety.js'

test('refuses filesystem root', () => {
  expect(() => assertScannableTarget(sep)).toThrow(/refuse/i)
})

test('refuses the bare home directory', () => {
  expect(() => assertScannableTarget(homedir())).toThrow(/refuse/i)
})

test('accepts a normal subfolder', () => {
  expect(() => assertScannableTarget(`${homedir()}${sep}Downloads`)).not.toThrow()
})

test('excludes known noise dirs', () => {
  expect(isExcluded('node_modules')).toBe(true)
  expect(isExcluded('project/.git/config')).toBe(true)
  expect(isExcluded('photos/cat.jpg')).toBe(false)
})

test('isInside is true only for real descendants', () => {
  expect(isInside('/a/b/c.txt', '/a/b')).toBe(true)
  expect(isInside('/a/bb/c.txt', '/a/b')).toBe(false)
  expect(isInside('/a/b/../x', '/a/b')).toBe(false)
})
