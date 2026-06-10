// Test the slot-extraction schema directly against Anthropic API via fetch.

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1) }

const tool = {
  name: 'extract_slots',
  description: 'Extract structured slot values from a customer SMS message.',
  input_schema: {
    type: 'object',
    properties: {
      updates: {
        type: 'object',
        properties: {
          first_name: { type: ['string', 'null'] },
          count: {
            anyOf: [
              { type: 'integer', minimum: 1 },
              { type: 'null' },
            ],
          },
          job_type: {
            anyOf: [
              { type: 'string', enum: ['downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting', 'unknown', 'out_of_scope'] },
              { type: 'null' },
            ],
          },
        },
      },
      reasoning: { type: 'string', maxLength: 300 },
    },
    required: ['updates'],
  },
}

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extract_slots' },
    messages: [{
      role: 'user',
      content: 'Customer just said: "6 downlights". Extract the slots.',
    }],
  }),
})

const json = await res.json()
if (!res.ok) {
  console.error('FAILURE — status', res.status)
  console.error(JSON.stringify(json, null, 2))
  process.exit(1)
}

console.log('SUCCESS — schema accepted')
const toolUse = (json.content || []).find(b => b.type === 'tool_use')
console.log('Tool result:', JSON.stringify(toolUse?.input, null, 2))
