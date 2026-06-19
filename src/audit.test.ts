import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { zoneStat, auditHome } from './audit.js'

async function zoneFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sweep-zone-'))
  await writeFile(join(root, 'a.png'), 'xx')
  await writeFile(join(root, 'b.png'), 'xx') // same size as a.png
  await writeFile(join(root, 'big.mp4'), 'x'.repeat(1000))
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'c.pdf'), 'x')
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'node_modules', 'skip.js'), 'x')
  return root
}

test('zoneStat aggregates, prunes excludes, finds biggest + dup bytes + loose count', async () => {
  const root = await zoneFixture()
  const s = await zoneStat(root, 'Demo')
  expect(s).not.toBeNull()
  expect(s!.totalFiles).toBe(4) // node_modules pruned
  expect(s!.looseFileCount).toBe(3) // a.png, b.png, big.mp4 (c.pdf is in sub/)
  expect(s!.biggestFiles[0].path).toBe('big.mp4')
  expect(s!.approxDuplicateBytes).toBe(2) // a.png & b.png share size 2 → (2-1)*2
  expect(s!.byType['.png'].count).toBe(2)
})

test('zoneStat returns null for a missing path', async () => {
  expect(await zoneStat('/no/such/zone/here', 'X')).toBeNull()
})

test('auditHome only includes existing zones', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sweep-home-'))
  await mkdir(join(home, 'Downloads'))
  await writeFile(join(home, 'Downloads', 'x.png'), 'x')
  const audit = await auditHome(home)
  expect(audit.zones.some((z) => z.name === 'Downloads')).toBe(true)
  expect(audit.zones.some((z) => z.name === 'Desktop')).toBe(false)
})
