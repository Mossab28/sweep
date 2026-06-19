import chalk from 'chalk'
import type { Plan } from './types.js'

export const PINK = chalk.hex('#ff4fa3')

export function banner(): string {
  return PINK.bold(
    [
      '                          ',
      '   ___ _ _____ ___ ___ ___ ',
      '  (_-</ | / -_) -_) _ \\___|',
      ' /___/\\_/\\___/\\__/ .__/    ',
      "                 sweep — tidy your files with AI",
    ].join('\n'),
  )
}

export function renderPlan(plan: Plan): string {
  const lines: string[] = []
  lines.push(PINK.bold(plan.summary))
  lines.push('')
  let moves = 0
  let folders = 0
  let quarantined = 0
  for (const op of plan.operations) {
    if (op.op === 'mkdir') {
      folders++
      lines.push(`  ${PINK('+')} folder  ${op.path}`)
    } else if (op.op === 'move' || op.op === 'rename') {
      moves++
      lines.push(`  ${PINK('→')} ${op.op.padEnd(6)} ${op.from} ${chalk.dim('→')} ${op.to}`)
    } else if (op.op === 'quarantine') {
      quarantined++
      lines.push(`  ${PINK('⌫')} trash   ${op.path}`)
    }
  }
  lines.push('')
  lines.push(
    chalk.dim(
      `${moves} move${moves === 1 ? '' : 's'}, ${folders} new folder${folders === 1 ? '' : 's'}, ${quarantined} quarantined`,
    ),
  )
  return lines.join('\n')
}
