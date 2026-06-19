import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'node:child_process'
import { buildPrompt, DEFAULT_MODEL } from './intent.js'
import { assertPlanWithinBounds, parsePlan } from './schema.js'
import type { Index, Intent, Plan } from './types.js'

export interface PlanClient {
  complete(prompt: string): Promise<string>
}

/** Strip a surrounding ```json ... ``` (or bare ``` ... ```) markdown fence, if present. */
export function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/
  const match = trimmed.match(fence)
  return (match ? match[1] : trimmed).trim()
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
    plan = parsePlan(stripFences(raw))
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

/**
 * A PlanClient that delegates to the local `claude` CLI in print mode
 * (`claude -p`), using the user's logged-in Claude Code session instead of an
 * API key. The prompt is piped via stdin to avoid argv length limits.
 */
export function claudeCodeClient(model?: string): PlanClient {
  return {
    complete(prompt: string): Promise<string> {
      return new Promise((resolve, reject) => {
        const args = ['-p', '--output-format', 'text']
        if (model) args.push('--model', model)
        const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        child.stdout.on('data', (d) => {
          out += d
        })
        child.stderr.on('data', (d) => {
          err += d
        })
        child.on('error', (e) =>
          reject(
            new Error(
              `Could not run the \`claude\` CLI (${e.message}). Install Claude Code and run \`claude\` once to log in.`,
            ),
          ),
        )
        child.on('close', (code) => {
          if (code === 0) resolve(out)
          else reject(new Error(`claude CLI exited with code ${code}: ${err.trim()}`))
        })
        child.stdin.write(prompt)
        child.stdin.end()
      })
    },
  }
}
