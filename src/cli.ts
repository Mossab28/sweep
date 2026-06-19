#!/usr/bin/env node
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Command, Option } from 'commander'
import { VERSION } from './index.js'
import { banner, PINK, renderPlan } from './render.js'
import { scan } from './scanner.js'
import { assertScannableTarget } from './safety.js'
import { anthropicClient, claudeCodeClient, createPlan, type PlanClient } from './planner.js'
import { execute, applyUndo } from './executor.js'
import { deleteUndoLog, loadLatestUndoLog, quarantineDir, saveUndoLog } from './store.js'
import type { Intent, IntentMode } from './types.js'

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function runTidy(
  target: string,
  opts: { mode?: string; instruction?: string; claudeCode?: boolean },
) {
  let client: PlanClient
  if (opts.claudeCode) {
    client = claudeCodeClient()
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error(
        PINK(
          'Set ANTHROPIC_API_KEY (your Claude API key), or pass --claude-code to use your logged-in Claude Code subscription instead.',
        ),
      )
      process.exit(1)
    }
    client = anthropicClient(apiKey)
  }
  const abs = resolve(target)
  assertScannableTarget(abs)

  let intent: Intent
  if (opts.instruction) {
    intent = { mode: 'custom', instruction: opts.instruction }
  } else {
    const mode = (opts.mode as IntentMode) ?? 'organize'
    intent = { mode }
  }

  console.log(banner())
  console.log(PINK(`\nScanning ${abs} ...`))
  const index = await scan(abs)
  console.log(`Found ${index.totalFiles} files, ${index.duplicates.length} duplicate groups.`)

  const stamp = nowStamp()
  const quarantine = quarantineDir(stamp)
  console.log(PINK(opts.claudeCode ? 'Asking Claude Code for a plan ...' : 'Asking Claude for a plan ...'))
  const plan = await createPlan(index, intent, abs, quarantine, client)

  console.log('\n' + renderPlan(plan) + '\n')
  const answer = await ask(PINK('Apply this plan? [y/N] '))
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted. Nothing changed.')
    return
  }

  const log = await execute(plan, abs, quarantine, stamp)
  const logPath = await saveUndoLog(log)
  console.log(PINK(`Done. Run "sweep undo" to revert. (log: ${logPath})`))
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
  .argument('<path>', 'folder to tidy')
  .addOption(new Option('-m, --mode <mode>', 'clean | organize').choices(['clean', 'organize']).default('organize'))
  .option('-i, --instruction <text>', 'free-form instruction (custom mode)')
  .option('-c, --claude-code', 'use your logged-in Claude Code session instead of an API key')
  .action((path, opts) => runTidy(path, opts))

program.command('undo').description('revert the last run').action(runUndo)

program.parseAsync().catch((err) => {
  console.error(PINK(`Error: ${err.message}`))
  process.exit(1)
})
