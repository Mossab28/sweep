import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, beforeEach } from 'vitest'
import { loadLatestUndoLog, saveUndoLog } from './store.js'
import type { UndoLog } from './types.js'

beforeEach(async () => {
  process.env.SWEEP_HOME = await mkdtemp(join(tmpdir(), 'sweep-home-'))
})

test('saves then loads the most recent undo log', async () => {
  const older: UndoLog = { timestamp: '2026-06-19T00-00-00', target: '/a', applied: [] }
  const newer: UndoLog = {
    timestamp: '2026-06-19T01-00-00',
    target: '/b',
    applied: [{ op: 'rmdir', path: '/b/images' }],
  }
  await saveUndoLog(older)
  await saveUndoLog(newer)
  const loaded = await loadLatestUndoLog()
  expect(loaded?.target).toBe('/b')
})

test('returns null when there is no history', async () => {
  expect(await loadLatestUndoLog()).toBeNull()
})
