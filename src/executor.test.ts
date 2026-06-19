import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { applyUndo, execute } from './executor.js'
import type { Plan } from './types.js'

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

test('executes a plan then undo restores the original state', async () => {
  const target = await mkdtemp(join(tmpdir(), 'sweep-exec-'))
  const trash = await mkdtemp(join(tmpdir(), 'sweep-trash-'))
  await writeFile(join(target, 'a.png'), 'img')
  await writeFile(join(target, 'dup.png'), 'img')

  const plan: Plan = {
    summary: 's',
    operations: [
      { op: 'mkdir', path: 'images' },
      { op: 'move', from: 'a.png', to: 'images/a.png' },
      { op: 'quarantine', path: 'dup.png' },
    ],
  }

  const log = await execute(plan, target, trash, '2026-06-19T00-00-00')
  expect(await exists(join(target, 'images', 'a.png'))).toBe(true)
  expect(await exists(join(target, 'a.png'))).toBe(false)
  expect(await exists(join(target, 'dup.png'))).toBe(false)

  await applyUndo(log)
  expect(await exists(join(target, 'a.png'))).toBe(true)
  expect(await exists(join(target, 'dup.png'))).toBe(true)
  expect(await exists(join(target, 'images', 'a.png'))).toBe(false)
})
