// Claude, over the network.
//
// The platform spends a hosted model on four things only: the first mapping of
// an app, an unknown screen, a repair after the UI moved, and turning a
// sentence into an intent. Every routine push and read is a deterministic
// script driven by an appmap, because a model that re-derives Facebook from
// scratch on every hours change is both slower and less reliable than a
// recorded route.
//
// The SDK is imported lazily so a checkout with no key and no network still
// boots, runs the demos, and passes the tests.
const CATALOGUE = [
  { id: 'claude-opus-5',    strength: 5, speed: 3, vision: true, centsPerCall: 4.0, local: false },
  { id: 'claude-sonnet-5',  strength: 4, speed: 4, vision: true, centsPerCall: 1.2, local: false },
  { id: 'claude-haiku-4-5', strength: 3, speed: 5, vision: true, centsPerCall: 0.4, local: false },
];

export async function models(config = {}) {
  if (config.simulate) return CATALOGUE.map(m => ({ ...m, centsPerCall: 0 }));
  return CATALOGUE;
}

export async function complete({ model, task, config = {} }) {
  if (config.simulate || !hasKey(config)) return simulated({ model, task });
  const client = await clientFor(config);
  const request = {
    model,
    max_tokens: task.maxTokens ?? 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: task.effort ?? 'high' },
    system: task.system,
    messages: [{ role: 'user', content: task.prompt }],
  };
  // A schema turns the answer into something the kernel can act on without
  // parsing prose. The intent parser depends on this.
  if (task.schema) {
    request.output_config.format = { type: 'json_schema', schema: task.schema };
  }
  const response = await client.messages.create(request);
  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
  return {
    text,
    json: task.schema ? safeParse(text) : undefined,
    cents: cost(model, response.usage),
    usage: response.usage,
  };
}

function hasKey(config) {
  return Boolean(config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);
}

let cached = null;
async function clientFor(config) {
  if (cached) return cached;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  cached = new Anthropic(config.apiKey ? { apiKey: config.apiKey } : {});
  return cached;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

const RATES = {
  'claude-opus-5':    { in: 5.0,  out: 25.0 },
  'claude-sonnet-5':  { in: 2.0,  out: 10.0 },
  'claude-haiku-4-5': { in: 1.0,  out: 5.0 },
};
function cost(model, usage) {
  const rate = RATES[model];
  if (!rate || !usage) return 0;
  const dollars = (usage.input_tokens / 1e6) * rate.in + (usage.output_tokens / 1e6) * rate.out;
  return Number((dollars * 100).toFixed(4));
}

// Deterministic stand-in, so the demos and the whole verify path run with no
// key, no network and no spend.
function simulated({ model, task }) {
  return { text: `[${model}] ${String(task.prompt ?? '').slice(0, 200)}`, cents: 0, simulated: true };
}
