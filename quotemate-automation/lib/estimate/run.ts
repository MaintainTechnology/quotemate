import { anthropic } from '@ai-sdk/anthropic'
import { generateText, stepCountIs } from 'ai'
import { systemPrompt } from './prompt'
import * as tools from './tools'

export async function runEstimation(intake: any, pricingBook: any) {
  const result = await generateText({
    model: anthropic('claude-opus-4-7'),
    system: systemPrompt(pricingBook),
    prompt: `Draft a quote for this intake:\n\n${JSON.stringify(intake, null, 2)}`,
    tools,
    stopWhen: stepCountIs(10),  // build-guide says `maxSteps: 10`; AI SDK v5+ renamed it to stopWhen+stepCountIs
    maxRetries: 0,              // wrapper handles retries with logging — no double-retry
  })

  return parseJsonFromText(result.text)
}

// Opus often prefixes its response with reasoning ("Calculation: ...", "Here is the quote:")
// or wraps in ```json fences. Extract the first balanced { ... } block.
function parseJsonFromText(text: string): any {
  // Try direct parse first (happy path)
  const direct = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(direct) } catch {}

  // Fallback: find the first { and walk forward counting braces (respecting strings)
  const start = text.indexOf('{')
  if (start < 0) throw new Error(`No JSON object found in Opus output. First 300 chars: ${text.slice(0, 300)}`)

  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        try { return JSON.parse(candidate) }
        catch (e: any) {
          throw new Error(`Found JSON-shaped block but couldn't parse it: ${e.message}\n\nFirst 300 chars of candidate:\n${candidate.slice(0, 300)}`)
        }
      }
    }
  }

  throw new Error(`Unbalanced braces in Opus output. First 300 chars: ${text.slice(0, 300)}`)
}
