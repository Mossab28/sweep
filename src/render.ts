import chalk from 'chalk'
import type { Plan, Report } from './types.js'

export const PINK = chalk.hex('#ff4fa3')

export function banner(): string {
  const art = [
    '███████╗██╗    ██╗███████╗███████╗██████╗ ',
    '██╔════╝██║    ██║██╔════╝██╔════╝██╔══██╗',
    '███████╗██║ █╗ ██║█████╗  █████╗  ██████╔╝',
    '╚════██║██║███╗██║██╔══╝  ██╔══╝  ██╔═══╝ ',
    '███████║╚███╔███╔╝███████╗███████╗██║     ',
    '╚══════╝ ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝     ',
  ]
  return PINK.bold(art.join('\n')) + chalk.dim('\n        tidy your files with AI')
}

/** Visible width of a string, ignoring ANSI color escape codes. */
function vlen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '').length
}

/** A dim horizontal separator line. */
export function rule(width = 56): string {
  return chalk.dim('─'.repeat(width))
}

/** Wrap pre-colored body lines in a rounded pink box with a title. */
function boxed(title: string, body: string[]): string {
  const contentW = Math.max(vlen(title) + 1, 38, ...body.map(vlen))
  const innerW = contentW + 2
  const dashes = contentW - vlen(title) - 1
  const top = PINK('╭─ ') + PINK.bold(title) + ' ' + PINK('─'.repeat(dashes) + '╮')
  const bottom = PINK('╰' + '─'.repeat(innerW) + '╯')
  const rows = body.map(
    (l) => PINK('│') + ' ' + l + ' '.repeat(contentW - vlen(l)) + ' ' + PINK('│'),
  )
  return [top, ...rows, bottom].join('\n')
}

export function sortedZones(report: Report): Report['zones'] {
  return [...report.zones].sort((a, b) => a.priority - b.priority)
}

export function renderReport(report: Report): string {
  const zones = sortedZones(report)
  const body = zones.map(
    (z, i) =>
      `${PINK(`${i + 1})`)} ${chalk.bold(z.title)}  ${chalk.dim(z.reason)}`,
  )
  return PINK.bold(report.summary) + '\n\n' + boxedReport(body)
}

function boxedReport(body: string[]): string {
  return boxed('Report', body.length ? body : [chalk.dim('Nothing notable found.')])
}

export function menuHint(): string {
  return chalk.dim('Pick a number to tidy, ') + PINK('A') + chalk.dim(' to tidy all, ') + PINK('Q') + chalk.dim(' to quit')
}

export function renderPlan(plan: Plan): string {
  const body: string[] = []
  let moves = 0
  let folders = 0
  let quarantined = 0
  for (const op of plan.operations) {
    if (op.op === 'mkdir') {
      folders++
      body.push(`${PINK('+')} folder  ${op.path}`)
    } else if (op.op === 'move' || op.op === 'rename') {
      moves++
      body.push(`${PINK('→')} ${op.op.padEnd(6)} ${op.from} ${chalk.dim('→')} ${op.to}`)
    } else if (op.op === 'quarantine') {
      quarantined++
      body.push(`${PINK('⌫')} trash   ${op.path}`)
    }
  }
  body.push('')
  body.push(
    chalk.dim(
      `${moves} move${moves === 1 ? '' : 's'}, ${folders} new folder${folders === 1 ? '' : 's'}, ${quarantined} quarantined`,
    ),
  )
  return PINK.bold(plan.summary) + '\n\n' + boxed('Plan', body)
}
