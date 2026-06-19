import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

test('quarantine preserves directory structure in trash and undo restores it', async () => {
  const target = await mkdtemp(join(tmpdir(), 'sweep-exec-nested-'))
  const trash = await mkdtemp(join(tmpdir(), 'sweep-trash-nested-'))
  await mkdir(join(target, 'sub'), { recursive: true })
  await writeFile(join(target, 'sub', 'dup.png'), 'img')

  const plan: Plan = {
    summary: 's',
    operations: [{ op: 'quarantine', path: 'sub/dup.png' }],
  }

  const log = await execute(plan, target, trash, '2026-06-19T00-00-00')
  // file must land at <trash>/sub/dup.png, not <trash>/sub__dup.png
  expect(await exists(join(trash, 'sub', 'dup.png'))).toBe(true)
  expect(await exists(join(target, 'sub', 'dup.png'))).toBe(false)

  await applyUndo(log)
  expect(await exists(join(target, 'sub', 'dup.png'))).toBe(true)
})

test('execute throws before any mutation when plan has conflicting destinations', async () => {
  const target = await mkdtemp(join(tmpdir(), 'sweep-exec-conflict-'))
  const trash = await mkdtemp(join(tmpdir(), 'sweep-trash-conflict-'))
  await writeFile(join(target, 'a.png'), 'img')
  await writeFile(join(target, 'b.png'), 'img2')

  const plan: Plan = {
    summary: 's',
    operations: [
      { op: 'move', from: 'a.png', to: 'out.png' },
      { op: 'move', from: 'b.png', to: 'out.png' }, // same destination → conflict
    ],
  }

  await expect(execute(plan, target, trash, '2026-06-19T00-00-00')).rejects.toThrow(
    /conflicting destinations/i,
  )
  // source files must be untouched
  expect(await exists(join(target, 'a.png'))).toBe(true)
  expect(await exists(join(target, 'b.png'))).toBe(true)
})

test('execute throws before any mutation when destination already exists on disk', async () => {
  const target = await mkdtemp(join(tmpdir(), 'sweep-exec-overwrite-'))
  const trash = await mkdtemp(join(tmpdir(), 'sweep-trash-overwrite-'))
  await writeFile(join(target, 'a.png'), 'img')
  await writeFile(join(target, 'existing.png'), 'already here')

  const plan: Plan = {
    summary: 's',
    operations: [{ op: 'move', from: 'a.png', to: 'existing.png' }],
  }

  await expect(execute(plan, target, trash, '2026-06-19T00-00-00')).rejects.toThrow(
    /destination already exists/i,
  )
  expect(await exists(join(target, 'a.png'))).toBe(true)
})

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
