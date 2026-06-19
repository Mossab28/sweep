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
  const plan = parsePlan(raw.trim())
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
