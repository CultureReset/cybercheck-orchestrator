// Fills the `voice` slot. See README.md for what was changed on the way in
// from ghost-ai.
//
// The rule this file exists to keep: it names no capability. What a caller can
// say is whatever the caller has been granted, handed in at call time.

const API = 'https://api.openai.com/v1';

const need = () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('voice_openai: OPENAI_API_KEY is not set');
  return key;
};

async function post(path, body, key, { form = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, ...(form ? {} : { 'content-type': 'application/json' }) },
    body: form ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`voice_openai: ${path} returned ${res.status} ${detail.slice(0, 200)}`);
  }
  return res;
}

/* ── speech in ───────────────────────────────────────────────────────────── */

export async function transcribe({ audio, mimeType = 'audio/wav', config = {} }) {
  const key = need();
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), 'audio');
  form.append('model', config.transcribeModel ?? 'whisper-1');
  const res = await post('/audio/transcriptions', form, key, { form: true });
  const body = await res.json();
  return { text: (body.text ?? '').trim(), durationMs: body.duration ? body.duration * 1000 : null };
}

/* ── transcript to intent ────────────────────────────────────────────────── */

// The capability list is the entire vocabulary. Everything a caller can ask
// for is in here, and nothing else is reachable — which is why this function
// takes it as an argument instead of importing a catalogue.
function toolsFrom(capabilities) {
  return capabilities.map((cap) => ({
    type: 'function',
    function: {
      name: cap.key.replace(/\./g, '__'),   // OpenAI tool names disallow dots
      description: cap.summary ?? cap.key,
      parameters: cap.input && Object.keys(cap.input).length
        ? cap.input
        : { type: 'object', properties: {}, additionalProperties: true },
    },
  }));
}

const SYSTEM = [
  'You take a spoken request from a business owner and match it to exactly one',
  'action they are allowed to take. Only the supplied tools exist.',
  'If nothing fits, call no tool and reply in one short sentence saying what you',
  'can do instead. Never invent an action. Never guess a value the owner did not',
  'say — leave it out and ask for it in your reply.',
].join(' ');

export async function intent({ transcript, capabilities = [], config = {} }) {
  if (!transcript || !transcript.trim()) {
    return { capability: null, input: {}, confidence: 0, say: 'I did not catch that.' };
  }
  if (capabilities.length === 0) {
    // Not an error. A caller with no grants can still be answered honestly.
    return { capability: null, input: {}, confidence: 0, say: 'There is nothing I am allowed to do on this account yet.' };
  }

  const key = need();
  const res = await post('/chat/completions', {
    model: config.model ?? 'gpt-4o',
    temperature: 0,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: transcript }],
    tools: toolsFrom(capabilities),
    tool_choice: 'auto',
  }, key);

  const message = (await res.json()).choices?.[0]?.message ?? {};
  const call = message.tool_calls?.[0];
  if (!call) {
    return { capability: null, input: {}, confidence: 0, say: message.content?.trim() || 'I cannot do that one.' };
  }

  const chosen = call.function.name.replace(/__/g, '.');
  // A model naming something outside the list is a refusal, not an action.
  if (!capabilities.some((c) => c.key === chosen)) {
    return { capability: null, input: {}, confidence: 0, say: 'I cannot do that one.' };
  }

  let input = {};
  try { input = JSON.parse(call.function.arguments || '{}'); } catch { input = {}; }

  return {
    capability: chosen,
    input,
    confidence: 1,
    say: message.content?.trim() || null,
  };
}

/* ── speech out ──────────────────────────────────────────────────────────── */

export async function speak({ text, config = {} }) {
  const key = need();
  const res = await post('/audio/speech', {
    model: config.speechModel ?? 'gpt-4o-mini-tts',
    voice: config.voice ?? 'alloy',
    input: text,
  }, key);
  return { audio: Buffer.from(await res.arrayBuffer()), mimeType: 'audio/mpeg' };
}

/* ── live calls ──────────────────────────────────────────────────────────── */

// Ported from ghost-ai's session map. Sessions are in memory on purpose: a call
// that outlives the process is over, and persisting a dead one would only make
// the next restart replay it.
const sessions = new Map();

export function openSession({ callId, businessId = null, onTranscript = null }) {
  const session = { callId, businessId, onTranscript, startedAt: Date.now(), turns: [] };
  sessions.set(callId, session);
  return session;
}

export function closeSession({ callId }) {
  const session = sessions.get(callId);
  if (!session) return { durationMs: 0, turns: 0 };
  sessions.delete(callId);
  return { durationMs: Date.now() - session.startedAt, turns: session.turns.length };
}

export function sessionCount() { return sessions.size; }
