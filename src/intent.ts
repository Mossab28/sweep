import type { Index, Intent } from './types.js'

export const DEFAULT_MODEL = process.env.SWEEP_MODEL ?? 'claude-opus-4-8'

const MODE_GOAL: Record<string, string> = {
  clean:
    'Clean up this folder: identify duplicates, junk/temp files, old installers, and large unused files, and quarantine them to free space.',
  organize:
    'Organize this folder: sort files into intelligent category subfolders (images, documents, installers, code, ...) and tidy messy filenames.',
  custom: '',
}

function compactIndex(index: Index): string {
  const types = Object.entries(index.byType)
    .map(([ext, v]) => `${ext}: ${v.count} files, ${v.bytes} bytes`)
    .join('\n')
  const dups = index.duplicates
    .map((g) => `- ${g.paths.join(', ')} (identical, ${g.size} bytes each)`)
    .join('\n')
  const listing = index.files
    .map((f) => `${f.path}\t${f.size}\t${new Date(f.mtime).toISOString()}`)
    .join('\n')
  return [
    `Root: ${index.root}`,
    `Total: ${index.totalFiles} files, ${index.totalBytes} bytes`,
    `By type:\n${types}`,
    `Duplicate groups:\n${dups || '(none)'}`,
    `Files (path\tsize\tmtime):\n${listing}`,
  ].join('\n\n')
}

export function buildPrompt(index: Index, intent: Intent): string {
  const goal = intent.mode === 'custom' ? (intent.instruction ?? '') : MODE_GOAL[intent.mode]
  return [
    'You are sweep, a careful file-organizing assistant.',
    `Task: ${goal}`,
    'Here is a summary of the target folder. All paths are relative to its root:',
    compactIndex(index),
    '',
    'Respond with ONLY a JSON object (no prose, no markdown fences) of the form:',
    '{"summary": string, "operations": Operation[]}',
    'where each Operation is one of:',
    '{"op":"mkdir","path":"<relative dir>"}',
    '{"op":"move","from":"<relative>","to":"<relative>"}',
    '{"op":"rename","from":"<relative>","to":"<relative>"}',
    '{"op":"quarantine","path":"<relative>"}  // use this instead of deleting',
    'Rules: every path stays inside the folder; never delete, only quarantine; create dirs before moving into them.',
  ].join('\n')
}
