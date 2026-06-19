#!/usr/bin/env node
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Command, Option } from 'commander'
import chalk from 'chalk'
import { VERSION } from './index.js'
import { banner, PINK, renderPlan, renderPlanSummary, renderPlanDetail, rule, renderReport, menuHint, sortedZones } from './render.js'
import { scan } from './scanner.js'
import { assertScannableTarget } from './safety.js'
import {
  anthropicClient,
  claudeCodeAvailable,
  claudeCodeClient,
  createPlan,
  type PlanClient,
} from './planner.js'
import { execute, applyUndo } from './executor.js'
import { deleteUndoLog, loadLatestUndoLog, quarantineDir, saveUndoLog } from './store.js'
import { summarizePlan } from './summarize.js'
import { findSensitive } from './sensitive.js'
import { refineTurn } from './converse.js'
import type { ConversationTurn, Index, Intent, IntentMode, Notable, Plan, Rename, Strategy, ZoneStat } from './types.js'
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

/**
 * Choose the AI backend. Default: your Claude Code subscription (auto-detected).
 * The API is used only when you pass --api. Falls back to the API key only if
 * Claude Code isn't installed.
 */
async function pickClient(opts: {
  claudeCode?: boolean
  api?: boolean
}): Promise<{ client: PlanClient; label: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  // Explicit API mode.
  if (opts.api) {
    if (!apiKey) {
      console.error(PINK('--api needs ANTHROPIC_API_KEY set (your Claude API key).'))
      process.exit(1)
    }
    return { client: anthropicClient(apiKey), label: 'Claude (API)' }
  }

  // Default: Claude Code subscription if available (or forced with -c).
  if (opts.claudeCode || (await claudeCodeAvailable())) {
    return { client: claudeCodeClient(), label: 'Claude Code' }
  }

  // No Claude Code — fall back to an API key if the user has one.
  if (apiKey) return { client: anthropicClient(apiKey), label: 'Claude (API)' }

  console.error(
    PINK('sweep uses Claude Code (your subscription) by default.\n') +
      `Install it → ${chalk.underline('https://claude.com/claude-code')} and run \`claude\` once to log in.\n` +
      chalk.dim('Or set ANTHROPIC_API_KEY and re-run with --api to use the Claude API.'),
  )
  process.exit(1)
}

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
}

async function runAudit(opts: { claudeCode?: boolean; api?: boolean }): Promise<void> {
  const { client, label: source } = await pickClient(opts)
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
  opts: { mode?: string; instruction?: string; claudeCode?: boolean; api?: boolean },
) {
  const { client, label: source } = await pickClient(opts)
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
  .option('-c, --claude-code', 'force your Claude Code subscription (default when installed)')
  .option('--api', 'use the Claude API (needs ANTHROPIC_API_KEY) instead of the subscription')
  .action((path, opts) => (path ? runTidy(path, opts) : runAudit(opts)))

program.command('undo').description('revert the last run').action(runUndo)

program.parseAsync().catch((err) => {
  console.error(PINK(`Error: ${err.message}`))
  process.exit(1)
})
