# Conversational Tidy & Claude-style Output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw per-file plan dump with a Claude-style grouped summary (notable/sensitive files called out, full detail on demand), and let the user chat to refine the plan ("clean everything except the screenshots") before applying.

**Architecture:** A local `summarizePlan` turns a `Plan` into a grouped `PlanSummary`; `sensitive` detects secret-looking files and `expandStrategy` leaves them (and `keep`-matched files) untouched; `converse.refineTurn` asks Claude for a small `{reply, strategy|null}` each chat turn and the new strategy is re-expanded locally; `render` shows the summary + detail; the CLI drives a `y/d/n/chat` loop. Execution, quarantine and undo are unchanged.

**Tech Stack:** Node 20+, TypeScript (ESM), vitest, commander, zod, chalk, `claude -p` subprocess or `@anthropic-ai/sdk`.

## Global Constraints

- Runtime **Node >= 20**, ESM (`"type": "module"`); imports use `.js` extension.
- Test runner **vitest**; tests in `src/**/*.test.ts`; temp fixtures; **no network** (the `PlanClient` is injected/mocked).
- Claude output stays **small** — a report, a `Strategy`, or a refine `{reply, strategy|null}`; concrete operations are produced locally by `expandStrategy`.
- **No real deletion** (quarantine to `~/.sweep/trash/<timestamp>/`); dry-run; full undo; every op stays inside the target (`assertPlanWithinBounds`).
- **Sensitive files are never moved or quarantined.**
- `Category` union is unchanged: `"image" | "video" | "audio" | "document" | "archive" | "installer" | "code" | "data" | "other"`.
- Chat refine loop applies to the **strategy-based** flow (audit-menu zones + `sweep <path>` organize/clean). The `-i` per-file path keeps its behaviour but gets the new summary render.

---

### Task 1: Types for summary, notable, conversation, and `keep`

**Files:**
- Modify: `src/types.ts` (append; do not change existing exports, except adding one optional field to `Strategy`)

**Interfaces:**
- Consumes: existing `FileEntry`, `Strategy`.
- Produces: `PlanSummary`, `SummaryGroup`, `QuarantineBreakdown`, `Notable`, `Rename`, `ConversationTurn`; `Strategy.keep?: string[]`.

- [ ] **Step 1: Append the new types and extend `Strategy` in `src/types.ts`**

Add at the end of the file:

```ts
export interface SummaryGroup {
  /** destination top folder, e.g. "Documents" */
  folder: string
  count: number
  /** a few representative extensions, e.g. [".pdf", ".docx"] */
  exts: string[]
}

export interface QuarantineBreakdown {
  total: number
  duplicates: number
  junk: number
}

export interface PlanSummary {
  moveCount: number
  folderCount: number
  groups: SummaryGroup[]
  quarantine: QuarantineBreakdown
}

export interface Rename {
  from: string
  to: string
}

export interface Notable {
  /** sensitive files left untouched */
  sensitive: FileEntry[]
  /** files whose name was tidied during a move */
  renames: Rename[]
  /** count of files left in place because of a `keep` rule */
  keptCount: number
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
}
```

Then find the existing `Strategy` interface and add one optional field:

```ts
export interface Strategy {
  summary: string
  folders: TargetFolder[]
  quarantineDuplicates: boolean
  quarantineJunk: boolean
  renameMessy: boolean
  /** filename substrings to leave untouched (e.g. ["screenshot"]) */
  keep?: string[]
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: types for plan summary, notable files, conversation, keep"
```

---

### Task 2: Sensitive-file detection

**Files:**
- Create: `src/sensitive.ts`, `src/sensitive.test.ts`

**Interfaces:**
- Consumes: `FileEntry`, `Index` (existing types).
- Produces:
  - `isSensitive(name: string): boolean`
  - `findSensitive(index: Index): FileEntry[]`

- [ ] **Step 1: Write the failing test `src/sensitive.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sensitive.test.ts`
Expected: FAIL — `./sensitive.js` not found.

- [ ] **Step 3: Create `src/sensitive.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sensitive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sensitive.ts src/sensitive.test.ts
git commit -m "feat: sensitive-file detection (left untouched)"
```

---

### Task 3: `expandStrategy` skips sensitive + `keep` files

**Files:**
- Modify: `src/strategy.ts`
- Modify: `src/strategy.test.ts` (add cases)

**Interfaces:**
- Consumes: `isSensitive` (Task 2); `Strategy.keep` (Task 1).
- Produces: `expandStrategy` now leaves sensitive files and `keep`-matched files untouched (no `move`/`quarantine`/`rename` op for them); `StrategySchema` accepts an optional `keep: string[]`.

- [ ] **Step 1: Add failing tests to `src/strategy.test.ts`**

Append these tests (keep the existing ones):

```ts
test('expandStrategy never touches a sensitive file', () => {
  const idx: Index = {
    root: '/z', totalFiles: 2, totalBytes: 2, byType: {}, duplicates: [],
    files: [
      { path: '.env', name: '.env', ext: '', size: 1, mtime: 0 },
      { path: 'a.png', name: 'a.png', ext: '.png', size: 1, mtime: 0 },
    ],
  }
  const plan = expandStrategy(idx, strategy, '/z', '/trash/x', Date.UTC(2026, 5, 19))
  const touched = plan.operations.some(
    (o) => (o.op === 'move' && o.from === '.env') || (o.op === 'quarantine' && o.path === '.env'),
  )
  expect(touched).toBe(false)
})

test('expandStrategy leaves keep-matched files untouched', () => {
  const idx: Index = {
    root: '/z', totalFiles: 2, totalBytes: 2, byType: {}, duplicates: [],
    files: [
      { path: 'screenshot-1.png', name: 'screenshot-1.png', ext: '.png', size: 1, mtime: 0 },
      { path: 'photo.png', name: 'photo.png', ext: '.png', size: 1, mtime: 0 },
    ],
  }
  const keepStrategy = { ...strategy, keep: ['screenshot'] }
  const plan = expandStrategy(idx, keepStrategy, '/z', '/trash/x', Date.UTC(2026, 5, 19))
  const movedFrom = plan.operations.filter((o) => o.op === 'move').map((o) => (o.op === 'move' ? o.from : ''))
  expect(movedFrom).toContain('photo.png')
  expect(movedFrom).not.toContain('screenshot-1.png')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/strategy.test.ts`
Expected: FAIL — sensitive `.env` and `screenshot-1.png` are currently moved.

- [ ] **Step 3: Update `src/strategy.ts`**

Add the import at the top (next to the existing imports):

```ts
import { isSensitive } from './sensitive.js'
```

Extend `StrategySchema` to accept `keep` (add the field to the existing `z.object`):

```ts
const StrategySchema = z.object({
  summary: z.string(),
  folders: z.array(z.object({ name: z.string().min(1), accepts: z.array(z.enum(CATEGORIES)) })),
  quarantineDuplicates: z.boolean(),
  quarantineJunk: z.boolean(),
  renameMessy: z.boolean(),
  keep: z.array(z.string()).optional(),
})
```

In `expandStrategy`, add a skip helper and apply it at the top of the per-file loop (just inside `for (const file of index.files) {`, before the existing duplicate/junk checks):

```ts
  const keep = strategy.keep ?? []
  const isKept = (name: string): boolean => keep.some((k) => name.toLowerCase().includes(k.toLowerCase()))
```

(declare `keep`/`isKept` once, above the `for` loop), then as the first statement inside the loop:

```ts
    if (isSensitive(file.path) || isSensitive(file.name) || isKept(file.name)) continue
```

Also guard the duplicate-quarantine pass so a sensitive/kept duplicate is not quarantined — change the duplicate loop body to skip them:

```ts
  if (strategy.quarantineDuplicates) {
    for (const group of index.duplicates) {
      for (const p of group.paths.slice(1)) {
        const base = p.split('/').pop() ?? p
        if (isSensitive(p) || isSensitive(base) || isKept(base)) continue
        ops.push({ op: 'quarantine', path: p })
        quarantined.add(p)
      }
    }
  }
```

- [ ] **Step 4: Run the strategy tests to verify they pass**

Run: `npx vitest run src/strategy.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/strategy.ts src/strategy.test.ts
git commit -m "feat: expandStrategy leaves sensitive + keep-matched files untouched"
```

---

### Task 4: Plan summary (local grouping)

**Files:**
- Create: `src/summarize.ts`, `src/summarize.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Index`, `PlanSummary` (Tasks 1 + existing); `isJunk` (`src/categorize.js`).
- Produces: `summarizePlan(plan: Plan, index: Index, now: number): PlanSummary`.

- [ ] **Step 1: Write the failing test `src/summarize.test.ts`**

```ts
import { expect, test } from 'vitest'
import { summarizePlan } from './summarize.js'
import type { Index, Plan } from './types.js'

const index: Index = {
  root: '/z',
  totalFiles: 4,
  totalBytes: 4,
  byType: {},
  duplicates: [{ hash: 'h', size: 1, paths: ['a.png', 'b.png'] }],
  files: [
    { path: 'a.png', name: 'a.png', ext: '.png', size: 1, mtime: 0, hash: 'h' },
    { path: 'b.png', name: 'b.png', ext: '.png', size: 1, mtime: 0, hash: 'h' },
    { path: 'doc.pdf', name: 'doc.pdf', ext: '.pdf', size: 1, mtime: 0 },
    { path: 'old.dmg', name: 'old.dmg', ext: '.dmg', size: 1, mtime: 0 },
  ],
}

const plan: Plan = {
  summary: 's',
  operations: [
    { op: 'mkdir', path: 'Images' },
    { op: 'mkdir', path: 'Documents' },
    { op: 'move', from: 'a.png', to: 'Images/a.png' },
    { op: 'move', from: 'doc.pdf', to: 'Documents/doc.pdf' },
    { op: 'quarantine', path: 'b.png' }, // duplicate of a.png
    { op: 'quarantine', path: 'old.dmg' }, // junk (old installer)
  ],
}

test('groups moves by destination folder with counts and exts', () => {
  const s = summarizePlan(plan, index, Date.UTC(2026, 5, 19))
  expect(s.moveCount).toBe(2)
  expect(s.folderCount).toBe(2)
  const images = s.groups.find((g) => g.folder === 'Images')!
  expect(images.count).toBe(1)
  expect(images.exts).toContain('.png')
})

test('splits quarantine into duplicates and junk', () => {
  const s = summarizePlan(plan, index, Date.UTC(2026, 5, 19))
  expect(s.quarantine.total).toBe(2)
  expect(s.quarantine.duplicates).toBe(1) // b.png
  expect(s.quarantine.junk).toBe(1) // old.dmg
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/summarize.test.ts`
Expected: FAIL — `./summarize.js` not found.

- [ ] **Step 3: Create `src/summarize.ts`**

```ts
import { isJunk } from './categorize.js'
import type { Index, Plan, PlanSummary, SummaryGroup } from './types.js'

export function summarizePlan(plan: Plan, index: Index, now: number): PlanSummary {
  const byFolder = new Map<string, { count: number; exts: Set<string> }>()
  let moveCount = 0
  for (const op of plan.operations) {
    if (op.op === 'move' || op.op === 'rename') {
      moveCount++
      const folder = op.to.includes('/') ? op.to.slice(0, op.to.indexOf('/')) : '(root)'
      const dot = op.to.lastIndexOf('.')
      const ext = dot > op.to.lastIndexOf('/') ? op.to.slice(dot).toLowerCase() : ''
      const g = byFolder.get(folder) ?? { count: 0, exts: new Set<string>() }
      g.count++
      if (ext) g.exts.add(ext)
      byFolder.set(folder, g)
    }
  }
  const groups: SummaryGroup[] = [...byFolder.entries()]
    .map(([folder, g]) => ({ folder, count: g.count, exts: [...g.exts].slice(0, 4) }))
    .sort((a, b) => b.count - a.count)

  // quarantine breakdown: a quarantined path that is in a duplicate group is a
  // duplicate; otherwise classified as junk if the heuristic matches, else junk.
  const dupPaths = new Set<string>()
  for (const grp of index.duplicates) for (const p of grp.paths.slice(1)) dupPaths.add(p)
  const byPath = new Map(index.files.map((f) => [f.path, f]))
  let duplicates = 0
  let junk = 0
  let total = 0
  for (const op of plan.operations) {
    if (op.op !== 'quarantine') continue
    total++
    if (dupPaths.has(op.path)) {
      duplicates++
      continue
    }
    const file = byPath.get(op.path)
    if (file && isJunk(file, now)) junk++
    else junk++ // not a known duplicate → count as junk/clutter
  }

  return {
    moveCount,
    folderCount: groups.filter((g) => g.folder !== '(root)').length,
    groups,
    quarantine: { total, duplicates, junk },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/summarize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/summarize.ts src/summarize.test.ts
git commit -m "feat: summarizePlan groups a plan for a human-readable view"
```

---

### Task 5: Render the summary + detail views

**Files:**
- Modify: `src/render.ts`
- Create: `src/render-summary.test.ts`

**Interfaces:**
- Consumes: `PINK`, `rule`, `boxed` (existing in `render.ts`); `PlanSummary`, `Notable`, `Plan` (types).
- Produces:
  - `renderPlanSummary(summary: PlanSummary, notable: Notable): string`
  - `renderPlanDetail(plan: Plan): string`

- [ ] **Step 1: Write the failing test `src/render-summary.test.ts`**

```ts
import { expect, test } from 'vitest'
import { renderPlanSummary, renderPlanDetail } from './render.js'
import type { Notable, Plan, PlanSummary } from './types.js'

const summary: PlanSummary = {
  moveCount: 492,
  folderCount: 2,
  groups: [
    { folder: 'Documents', count: 312, exts: ['.pdf', '.docx'] },
    { folder: 'Images', count: 180, exts: ['.png', '.jpg'] },
  ],
  quarantine: { total: 89, duplicates: 62, junk: 27 },
}

const notable: Notable = {
  sensitive: [{ path: 'npm_recovery_codes.txt', name: 'npm_recovery_codes.txt', ext: '.txt', size: 1, mtime: 0 }],
  renames: [{ from: 'mt05-p24-final.pdf', to: 'Documents/mt05-p24.pdf' }],
  keptCount: 0,
}

test('summary shows groups, counts, quarantine split and sensitive callout', () => {
  const out = renderPlanSummary(summary, notable)
  expect(out).toMatch(/Documents/)
  expect(out).toMatch(/312/)
  expect(out).toMatch(/62 duplicate/i)
  expect(out).toMatch(/27/)
  expect(out).toMatch(/npm_recovery_codes\.txt/)
})

test('detail lists operations and truncates long groups', () => {
  const ops = Array.from({ length: 30 }, (_, i) => ({ op: 'move' as const, from: `f${i}.png`, to: `Images/f${i}.png` }))
  const plan: Plan = { summary: 's', operations: ops }
  const out = renderPlanDetail(plan)
  expect(out).toMatch(/Images/)
  expect(out).toMatch(/more/) // truncated with "…N more"
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render-summary.test.ts`
Expected: FAIL — `renderPlanSummary` not exported.

- [ ] **Step 3: Add to `src/render.ts`** (append; keep existing exports)

Add `import type { Notable, PlanSummary } from './types.js'` to the existing type import line (or a new import). Then:

```ts
const ICON: Record<string, string> = {
  Documents: '📄', Images: '🖼 ', Videos: '🎬', Audio: '🎵',
  Archives: '📦', Installers: '💿', Code: '💻', Data: '🗃 ', Other: '🗂 ',
}

export function renderPlanSummary(summary: PlanSummary, notable: Notable): string {
  const lines: string[] = []
  const setAside = summary.quarantine.total
  lines.push(
    PINK.bold(
      `Here's my plan — ${summary.moveCount} files into ${summary.folderCount} folders` +
        (setAside ? `, ${setAside} set aside.` : '.'),
    ),
  )
  const body: string[] = []
  for (const g of summary.groups) {
    if (g.folder === '(root)') continue
    const icon = ICON[g.folder] ?? '🗂 '
    const hint = g.exts.length ? chalk.dim(g.exts.join(', ')) : ''
    body.push(`${icon} ${chalk.bold(g.folder.padEnd(12))} ${PINK(String(g.count).padStart(4))}  ${hint}`)
  }
  if (summary.quarantine.total) {
    const parts: string[] = []
    if (summary.quarantine.duplicates) parts.push(`${summary.quarantine.duplicates} duplicates`)
    if (summary.quarantine.junk) parts.push(`${summary.quarantine.junk} junk`)
    body.push(
      `${'⌫ '} ${chalk.bold('Quarantine'.padEnd(12))} ${PINK(String(summary.quarantine.total).padStart(4))}  ${chalk.dim(parts.join(' · '))}`,
    )
  }
  lines.push(boxed('Plan', body))

  if (notable.sensitive.length || notable.renames.length || notable.keptCount) {
    lines.push('')
    lines.push(PINK('⚠️  Worth a look:'))
    for (const f of notable.sensitive.slice(0, 5)) {
      lines.push(`   • ${chalk.bold(f.name)} ${chalk.dim('— looks sensitive; left untouched.')}`)
    }
    if (notable.renames.length) {
      const r = notable.renames[0]
      const more = notable.renames.length - 1
      lines.push(
        `   • ${chalk.dim('renamed:')} ${r.from} ${chalk.dim('→')} ${r.to.split('/').pop()}` +
          (more > 0 ? chalk.dim(`  (and ${more} more)`) : ''),
      )
    }
    if (notable.keptCount) lines.push(`   • ${chalk.dim(`${notable.keptCount} kept untouched per your request.`)}`)
  }
  return lines.join('\n')
}

export function renderPlanDetail(plan: Plan): string {
  const byFolder = new Map<string, string[]>()
  const other: string[] = []
  for (const op of plan.operations) {
    if (op.op === 'move' || op.op === 'rename') {
      const folder = op.to.includes('/') ? op.to.slice(0, op.to.indexOf('/')) : '(root)'
      const arr = byFolder.get(folder) ?? []
      arr.push(`${op.from} ${chalk.dim('→')} ${op.to}`)
      byFolder.set(folder, arr)
    } else if (op.op === 'quarantine') {
      other.push(`${PINK('⌫')} ${op.path}`)
    }
  }
  const lines: string[] = []
  for (const [folder, items] of byFolder) {
    lines.push(PINK.bold(folder))
    for (const it of items.slice(0, 20)) lines.push(`  ${it}`)
    if (items.length > 20) lines.push(chalk.dim(`  …and ${items.length - 20} more`))
  }
  if (other.length) {
    lines.push(PINK.bold('Quarantine'))
    for (const it of other.slice(0, 20)) lines.push(`  ${it}`)
    if (other.length > 20) lines.push(chalk.dim(`  …and ${other.length - 20} more`))
  }
  return lines.join('\n')
}
```

> Note: `boxed`, `PINK`, `rule` and `chalk` are already present in `render.ts`. Reuse them; do not redefine.

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `npx vitest run src/render-summary.test.ts`
Expected: PASS.
Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render-summary.test.ts
git commit -m "feat: Claude-style plan summary render + detail view"
```

---

### Task 6: Conversational refine turn

**Files:**
- Create: `src/converse.ts`, `src/converse.test.ts`

**Interfaces:**
- Consumes: `PlanClient`, `stripFences` (`src/planner.js`); `PlanSummary`, `Strategy`, `ConversationTurn`, `ZoneStat` (types).
- Produces:
  - `buildRefinePrompt(zone: ZoneStat, summaryText: string, history: ConversationTurn[], userMessage: string): string`
  - `refineTurn(zone, summaryText, history, userMessage, client): Promise<{ reply: string; strategy: Strategy | null }>`

- [ ] **Step 1: Write the failing test `src/converse.test.ts`**

```ts
import { expect, test } from 'vitest'
import { refineTurn } from './converse.js'
import type { ZoneStat } from './types.js'

const zone: ZoneStat = {
  path: '/z', name: 'Downloads', totalFiles: 3, totalBytes: 3,
  byType: { '.png': { count: 2, bytes: 2 }, '.pdf': { count: 1, bytes: 1 } },
  approxDuplicateBytes: 0, biggestFiles: [], looseFileCount: 3,
}

test('parses a reply with a new strategy', async () => {
  const client = {
    complete: async () =>
      JSON.stringify({
        reply: 'Sure — keeping screenshots in place.',
        strategy: {
          summary: 'tidy minus screenshots',
          folders: [{ name: 'Images', accepts: ['image'] }],
          quarantineDuplicates: true, quarantineJunk: true, renameMessy: true,
          keep: ['screenshot'],
        },
      }),
  }
  const out = await refineTurn(zone, 'current plan...', [], 'clean everything except screenshots', client)
  expect(out.reply).toMatch(/screenshots/)
  expect(out.strategy?.keep).toContain('screenshot')
})

test('parses a clarifying question (no strategy)', async () => {
  const client = {
    complete: async () => JSON.stringify({ reply: 'Which files count as important?', strategy: null }),
  }
  const out = await refineTurn(zone, 'current plan...', [], 'keep the important ones', client)
  expect(out.reply).toMatch(/important/)
  expect(out.strategy).toBeNull()
})

test('rejects malformed output', async () => {
  await expect(
    refineTurn(zone, 'p', [], 'hi', { complete: async () => 'not json' }),
  ).rejects.toThrow(/did not understand/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/converse.test.ts`
Expected: FAIL — `./converse.js` not found.

- [ ] **Step 3: Create `src/converse.ts`**

```ts
import { z } from 'zod'
import { stripFences, type PlanClient } from './planner.js'
import type { ConversationTurn, Strategy, ZoneStat } from './types.js'

const CATEGORIES = [
  'image', 'video', 'audio', 'document', 'archive', 'installer', 'code', 'data', 'other',
] as const

const StrategyShape = z.object({
  summary: z.string(),
  folders: z.array(z.object({ name: z.string().min(1), accepts: z.array(z.enum(CATEGORIES)) })),
  quarantineDuplicates: z.boolean(),
  quarantineJunk: z.boolean(),
  renameMessy: z.boolean(),
  keep: z.array(z.string()).optional(),
})

const RefineSchema = z.object({
  reply: z.string(),
  strategy: StrategyShape.nullable(),
})

export function buildRefinePrompt(
  zone: ZoneStat,
  summaryText: string,
  history: ConversationTurn[],
  userMessage: string,
): string {
  const types = Object.entries(zone.byType).map(([e, v]) => `${e}: ${v.count}`).join(', ')
  const convo = history.map((t) => `${t.role === 'user' ? 'User' : 'You'}: ${t.text}`).join('\n')
  return [
    `You are sweep, tidying the folder "${zone.name}" together with the user.`,
    `Folder: ${zone.totalFiles} files. Types: ${types || '(none)'}.`,
    `Current plan summary:\n${summaryText}`,
    convo ? `Conversation so far:\n${convo}` : '',
    `User: ${userMessage}`,
    '',
    'Reply conversationally. If you can adjust the plan, return a new strategy; if you need to ask the user something first, return "strategy": null.',
    `Categories: ${CATEGORIES.join(', ')}.`,
    'Respond with ONLY a JSON object (no prose, no markdown fences):',
    '{"reply": string, "strategy": {"summary": string, "folders": [{"name": string, "accepts": Category[]}], "quarantineDuplicates": boolean, "quarantineJunk": boolean, "renameMessy": boolean, "keep"?: string[]} | null}',
    'Use "keep" for filename substrings the user wants left untouched (e.g. ["screenshot"]).',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function refineTurn(
  zone: ZoneStat,
  summaryText: string,
  history: ConversationTurn[],
  userMessage: string,
  client: PlanClient,
): Promise<{ reply: string; strategy: Strategy | null }> {
  const raw = await client.complete(buildRefinePrompt(zone, summaryText, history, userMessage))
  try {
    return RefineSchema.parse(JSON.parse(stripFences(raw)))
  } catch {
    throw new Error('Claude did not understand that (expected JSON). Please rephrase.')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/converse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/converse.ts src/converse.test.ts
git commit -m "feat: conversational refine turn (reply + optional new strategy)"
```

---

### Task 7: Wire the summary + chat loop into the CLI

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `summarizePlan` (Task 4); `findSensitive` (Task 2); `renderPlanSummary`, `renderPlanDetail` (Task 5); `refineTurn` (Task 6); `expandStrategy` (existing); `Notable`, `ConversationTurn`, `Rename`, `Plan`, `ZoneStat` (types); existing `withSpinner`, `ask`, `PINK`, `rule`, `execute`, `saveUndoLog`.
- Produces: a shared `confirmPlan(...)` helper used by `tidyZone` (and the strategy path of `runTidy`), returning the final `Plan` to apply or `null`.

- [ ] **Step 1: Add a `notableFrom` helper and a `confirmPlan` dialog to `src/cli.ts`**

Add new imports:

```ts
import { summarizePlan } from './summarize.js'
import { findSensitive } from './sensitive.js'
import { renderPlanSummary, renderPlanDetail } from './render.js'
import { refineTurn } from './converse.js'
import type { ConversationTurn, Index, Notable, Plan, Rename, Strategy, ZoneStat } from './types.js'
```

(Adjust the existing `import type { ... }` line so these names — including `Index` — are imported once.)

Add these functions above `tidyZone`:

```ts
function notableFrom(plan: Plan, index: Index): Notable {
  const renames: Rename[] = []
  for (const op of plan.operations) {
    if (op.op === 'move' || op.op === 'rename') {
      const fromBase = op.from.split('/').pop() ?? op.from
      const toBase = op.to.split('/').pop() ?? op.to
      if (fromBase !== toBase) renames.push({ from: op.from, to: op.to })
    }
  }
  return { sensitive: findSensitive(index), renames, keptCount: 0 }
}

/**
 * Show the plan as a Claude-style summary and run the y/d/n/chat loop.
 * Returns the plan to apply, or null if the user cancelled.
 */
async function confirmPlan(
  initial: Plan,
  ctx: { index: Index; zone: ZoneStat; target: string; quarantine: string; now: number; client: PlanClient; source: string },
): Promise<Plan | null> {
  let plan = initial
  const history: ConversationTurn[] = []
  for (;;) {
    const summary = summarizePlan(plan, ctx.index, ctx.now)
    const notable = notableFrom(plan, ctx.index)
    console.log('\n' + renderPlanSummary(summary, notable) + '\n')
    console.log(rule())
    const choice = await ask(
      `${PINK('▸')} ${chalk.dim('[y] apply · [d] details · [n] cancel · or tell me what to change')} `,
    )
    const c = choice.trim()
    if (c === '' || c.toLowerCase() === 'n') return null
    if (c.toLowerCase() === 'y') return plan
    if (c.toLowerCase() === 'd') {
      console.log('\n' + renderPlanDetail(plan) + '\n')
      continue
    }
    // chat turn
    history.push({ role: 'user', text: c })
    const summaryText = `${summary.moveCount} moves into ${summary.folderCount} folders, ${summary.quarantine.total} quarantined`
    let turn
    try {
      turn = await withSpinner(`Asking ${ctx.source}`, refineTurn(ctx.zone, summaryText, history, c, ctx.client))
    } catch (err) {
      console.log(chalk.dim((err as Error).message))
      continue
    }
    history.push({ role: 'assistant', text: turn.reply })
    console.log('\n' + PINK(turn.reply))
    if (turn.strategy) {
      plan = expandStrategy(ctx.index, turn.strategy as Strategy, ctx.target, ctx.quarantine, ctx.now)
    }
  }
}
```

- [ ] **Step 2: Use `confirmPlan` in `tidyZone`**

Replace the block in `tidyZone` that renders the plan and reads y/N (from `console.log('\n' + renderPlan(plan) + '\n')` through the `if (answer.toLowerCase() !== 'y')` return) with:

```ts
  const final = await confirmPlan(plan, {
    index,
    zone,
    target: zonePath,
    quarantine,
    now: Date.now(),
    client,
    source,
  })
  if (!final) {
    console.log(chalk.dim('Skipped. Nothing changed.'))
    return
  }
  const log = await withSpinner('Applying', execute(final, zonePath, quarantine, stamp))
  await saveUndoLog(log)
  console.log(`${PINK('✓')} Tidied ${zonePath}. Run ${chalk.bold('sweep undo')} to revert.`)
```

(Remove the now-unused local `plan`/`answer` lines it replaces; keep the `index`, `strategy`, `expandStrategy` lines that build the initial `plan`.)

- [ ] **Step 3: Build and smoke-test**

Run: `npm run build && node dist/cli.js --help`
Expected: still shows `[path]` and the flags.
Run: `node dist/cli.js / 2>&1 | head -1`
Expected: refuses `/` (the guard fires before any dialog).

- [ ] **Step 4: Run the full suite + tsc**

Run: `npx vitest run`
Expected: all pass.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: Claude-style summary + y/d/n/chat loop in tidy flow"
```

---

### Task 8: README — document the chat

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing. Docs only.

- [ ] **Step 1: Add a short "Talk to it" subsection under Usage**

```markdown
### Talk to it

When sweep shows a plan, you don't have to take it as-is. Type what you want and
it adjusts — then re-shows the plan:

```text
[y] apply · [d] details · [n] cancel · or tell me what to change
▸ clean everything except the screenshots
```

It can ask you questions too, and it leaves anything that looks sensitive
(recovery codes, `.env`, keys) untouched.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the conversational tidy"
```

---

## Notes for the implementer

- The injected `PlanClient` is the only network dependency; never call the real API/CLI in tests.
- `summarizePlan`, `notableFrom`, `expandStrategy`, `isSensitive` are pure/deterministic given a `now` — pass `Date.now()` from the CLI, fixed values in tests.
- Keep every Claude prompt aggregate-only — never embed full file listings in the refine prompt.
- `confirmPlan`/`notableFrom` take the zone's `Index` (from `scan()`) typed as `Index` — no casts.
