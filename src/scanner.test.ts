import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { scan } from './scanner.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sweep-scan-'))
  await writeFile(join(root, 'a.txt'), 'hello')
  await writeFile(join(root, 'b.txt'), 'hello') // duplicate of a.txt
  await writeFile(join(root, 'c.log'), 'different')
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'node_modules', 'skip.js'), 'x')
  return root
}

test('indexes files, skips excluded dirs, counts by type', async () => {
  const root = await fixture()
  const index = await scan(root)
  expect(index.totalFiles).toBe(3)
  expect(index.files.some((f) => f.path.includes('node_modules'))).toBe(false)
  expect(index.byType['.txt'].count).toBe(2)
})

test('detects duplicates by content', async () => {
  const root = await fixture()
  const index = await scan(root)
  const dupPaths = index.duplicates.flatMap((g) => g.paths).sort()
  expect(dupPaths).toEqual(['a.txt', 'b.txt'])
})
