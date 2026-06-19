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
