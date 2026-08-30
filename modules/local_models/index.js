// A model running on the box itself, through an OpenAI-shaped local runtime
// (Ollama, llama.cpp server, LM Studio — they all speak this shape).
//
// It exists for the work that should not leave the customer's hardware: a
// transcript of what the owner said out loud, and the contents of screens from
// apps holding their live business accounts. Routing decides which jobs those
// are, by asking for `local: true`; nothing here names a policy.
const ENDPOINT = process.env.LOCAL_MODEL_ENDPOINT ?? 'http://127.0.0.1:11434/v1';

export async function models(config = {}) {
  const id = config.model ?? process.env.LOCAL_MODEL ?? 'qwen2.5:7b-instruct';
  return [
    { id, strength: 2, speed: 3, vision: false, centsPerCall: 0, local: true },
  ];
}

export async function complete({ model, task, config = {} }) {
  const endpoint = config.endpoint ?? ENDPOINT;
  const messages = [];
  if (task.system) messages.push({ role: 'system', content: task.system });
  messages.push({ role: 'user', content: task.prompt });
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: task.temperature ?? 0,
      response_format: task.schema ? { type: 'json_object' } : undefined,
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 120000),
  });
  if (!res.ok) throw new Error(`local model ${model}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  return { text, json: task.schema ? safeParse(text) : undefined, cents: 0 };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
