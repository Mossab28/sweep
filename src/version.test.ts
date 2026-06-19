import { expect, test } from 'vitest'
import { VERSION } from './index.js'

test('exposes a semver version', () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
})
