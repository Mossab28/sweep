#!/usr/bin/env node
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Command, Option } from 'commander'
import chalk from 'chalk'
import { VERSION } from './index.js'
import { banner, PINK, renderPlan, rule, renderReport, menuHint, sortedZones } from './render.js'
import { scan } from './scanner.js'
import { assertScannableTarget } from './safety.js'
import { anthropicClient, claudeCodeClient, createPlan, type PlanClient } from './planner.js'
import { execute, applyUndo } from './executor.js'
import { deleteUndoLog, loadLatestUndoLog, quarantineDir, saveUndoLog } from './store.js'
import type { Intent, IntentMode } from './types.js'
import { auditHome, defaultHome } from './audit.js'
import { createReport } from './report.js'
import { createStrategy, expandStrategy } from './strategy.js'

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Show an animated spinner with an elapsed-seconds counter while `work` runs. */
async function withSpinner<T>(label: string, work: Promise<T>): Promise<T> {
  if (!stdout.isTTY) {
    console.log(PINK(`${label} ...`))
    return work
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const start = Date.now()
  let i = 0
  const timer = setInterval(() => {
    const secs = Math.floor((Date.now() - start) / 1000)
    stdout.write(`\r${PINK(frames[i++ % frames.length])} ${label} ${chalk.dim(`${secs}s`)}   `)
  }, 90)
  try {
    return await work
  } finally {
    clearInterval(timer)
    stdout.write('\r' + ' '.repeat(label.length + 16) + '\r')
  }
}

function pickClient(opts: { claudeCode?: boolean }): PlanClient {
  if (opts.claudeCode) return claudeCodeClient()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error(
      PINK(
        'Set ANTHROPIC_API_KEY (your Claude API key), or pass --claude-code to use your logged-in Claude Code session instead.',
      ),
    )
    process.exit(1)
  }
  return anthropicClient(apiKey)
}

async function tidyZone(zonePath: string, client: PlanClient, source: string): Promise<void> {
  assertScannableTarget(zonePath)
  const index = await withSpinner(`Scanning ${zonePath}`, scan(zonePath))
  const stamp = nowStamp()
  const quarantine = quarantineDir(stamp)
  const zone = {
    path: zonePath,
    name: zonePath.split('/').pop() || zonePath,
    totalFiles: index.totalFiles,
    totalBytes: index.totalBytes,
    byType: index.byType,
    approxDuplicateBytes: 0,
    biggestFiles: [],
    looseFileCount: index.files.length,
  }
  const strategy = await withSpinner(`Asking ${source} how to tidy`, createStrategy(zone, client))
  const existing = new Set(index.files.map((f) => f.path))
  const plan = expandStrategy(index, strategy, zonePath, quarantine, Date.now(), existing)
  console.log('\n' + renderPlan(plan) + '\n')
  console.log(rule())
  const answer = await ask(`${PINK('▸')} Apply this plan? ${chalk.dim('[y/N]')} `)
  if (answer.toLowerCase() !== 'y') {
    console.log(chalk.dim('Skipped. Nothing changed.'))
    return
  }
  const log = await withSpinner('Applying', execute(plan, zonePath, quarantine, stamp))
  await saveUndoLog(log)
  console.log(`${PINK('✓')} Tidied ${zonePath}. Run ${chalk.bold('sweep undo')} to revert.`)
}

async function runAudit(opts: { claudeCode?: boolean }): Promise<void> {
  const client = pickClient(opts)
  const source = opts.claudeCode ? 'Claude Code' : 'Claude'
  console.log('\n' + banner() + '\n')
  console.log(rule())
  const home = defaultHome()
  const audit = await withSpinner(`Auditing ${home}`, auditHome(home))
  if (audit.zones.length === 0) {
    console.log(chalk.dim('No tidyable content folders found.'))
    return
  }
  const report = await withSpinner(`Asking ${source} for a report`, createReport(audit, client))
  console.log('\n' + renderReport(report) + '\n')
  console.log(rule())

  const known = new Set(audit.zones.map((z) => z.path))
  const zones = sortedZones(report).filter((z) => known.has(z.path))
  if (zones.length === 0) {
    console.log(chalk.dim('No tidyable zones in the report.'))
    return
  }
  for (;;) {
    console.log(menuHint())
    const choice = (await ask(`${PINK('▸')} `)).trim().toLowerCase()
    if (choice === 'q' || choice === '') return
    if (choice === 'a') {
      for (const z of zones) {
        console.log(rule())
        console.log(`${PINK('▸')} Tidying ${chalk.bold(z.title)}`)
        await tidyZone(z.path, client, source)
      }
      console.log(`${PINK('✓')} All zones processed.`)
      return
    }
    const n = Number(choice)
    if (Number.isInteger(n) && n >= 1 && n <= zones.length) {
      console.log(rule())
      await tidyZone(zones[n - 1].path, client, source)
      console.log(rule())
    } else {
      console.log(chalk.dim('Not a valid choice.'))
    }
  }
}

async function runTidy(
  target: string,
  opts: { mode?: string; instruction?: string; claudeCode?: boolean },
) {
  const client = pickClient(opts)
  const abs = resolve(target)
  assertScannableTarget(abs)

  let intent: Intent
  if (opts.instruction) {
    intent = { mode: 'custom', instruction: opts.instruction }
  } else {
    const mode = (opts.mode as IntentMode) ?? 'organize'
    intent = { mode }
  }

  console.log('\n' + banner() + '\n')
  console.log(rule())
  console.log(`${PINK('▸')} Scanning ${chalk.bold(abs)}`)
  const index = await withSpinner('Scanning', scan(abs))
  console.log(
    `  ${chalk.dim(`${index.totalFiles} files, ${index.duplicates.length} duplicate groups`)}`,
  )
  if (index.totalFiles > 300) {
    console.log(chalk.dim('  (large folder — generating the plan can take a minute)'))
  }
  console.log(rule())

  const stamp = nowStamp()
  const quarantine = quarantineDir(stamp)
  const source = opts.claudeCode ? 'Claude Code' : 'Claude'
  const plan = await withSpinner(
    `Asking ${source} for a plan`,
    createPlan(index, intent, abs, quarantine, client),
  )

  console.log('\n' + renderPlan(plan) + '\n')
  console.log(rule())
  const answer = await ask(`${PINK('▸')} Apply this plan? ${chalk.dim('[y/N]')} `)
  if (answer.toLowerCase() !== 'y') {
    console.log(chalk.dim('Aborted. Nothing changed.'))
    return
  }

  const log = await withSpinner('Applying', execute(plan, abs, quarantine, stamp))
  const logPath = await saveUndoLog(log)
  console.log(`${PINK('✓')} Done. Run ${chalk.bold('sweep undo')} to revert.`)
  console.log(chalk.dim(`  log: ${logPath}`))
}

async function runUndo() {
  const log = await loadLatestUndoLog()
  if (!log) {
    console.log('Nothing to undo.')
    return
  }
  await applyUndo(log)
  await deleteUndoLog(log.timestamp)
  console.log(PINK(`Reverted the run from ${log.timestamp}.`))
}

const program = new Command()
program.name('sweep').description('AI-powered file cleanup & organizer').version(VERSION)

program
  .argument('[path]', 'folder to tidy (omit to audit your whole computer)')
  .addOption(new Option('-m, --mode <mode>', 'clean | organize').choices(['clean', 'organize']).default('organize'))
  .option('-i, --instruction <text>', 'free-form instruction (custom mode)')
  .option('-c, --claude-code', 'use your logged-in Claude Code session instead of an API key')
  .action((path, opts) => (path ? runTidy(path, opts) : runAudit(opts)))

program.command('undo').description('revert the last run').action(runUndo)

program.parseAsync().catch((err) => {
  console.error(PINK(`Error: ${err.message}`))
  process.exit(1)
})
