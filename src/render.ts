import chalk from 'chalk'
import type { Notable, Plan, PlanSummary, Report } from './types.js'

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
