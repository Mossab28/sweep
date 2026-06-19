import Anthropic from '@anthropic-ai/sdk'
import { buildPrompt, DEFAULT_MODEL } from './intent.js'
import { assertPlanWithinBounds, parsePlan } from './schema.js'
import type { Index, Intent, Plan } from './types.js'

export interface PlanClient {
  complete(prompt: string): Promise<string>
}

export async function createPlan(
  index: Index,
  intent: Intent,
  target: string,
  quarantine: string,
  client: PlanClient,
): Promise<Plan> {
  const prompt = buildPrompt(index, intent)
  const raw = await client.complete(prompt)
  let plan
  try {
    plan = parsePlan(raw.trim())
  } catch {
    throw new Error('Claude did not return a valid plan (expected JSON). Please try again.')
  }
  assertPlanWithinBounds(plan, target, quarantine)
  return plan
}

export function anthropicClient(apiKey: string): PlanClient {
  const anthropic = new Anthropic({ apiKey })
  return {
    async complete(prompt: string): Promise<string> {
      const msg = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      const block = msg.content.find((b) => b.type === 'text')
      return block && block.type === 'text' ? block.text : ''
    },
  }
}
