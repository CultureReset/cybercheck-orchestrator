// A model choosing capabilities until a goal is met.
//
// It never sees a capability the acting person could not invoke themselves, and
// it never sees one marked agentSafe:false — which is every capability that
// writes to an outside app through the device. The harness may look at what
// Facebook currently shows. It may not touch Facebook. That line is enforced in
// src/kernel/harness.js before this file is called; the loop below could not
// cross it if it tried.
const MAX_TURNS = 8;

export async function run({ ctx, goal, capabilities, invoke, think }) {
  const steps = [];
  const seen = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const decision = await think({
      need: 'reasoning',
      system: SYSTEM,
      schema: DECISION_SCHEMA,
      prompt: prompt({ goal, capabilities, seen }),
    });
    const choice = parse(decision.output);
    if (!choice) {
      steps.push({ turn, error: 'the model did not return a decision' });
      return { state: 'failed', reason: 'undecidable', steps };
    }
    if (choice.done) {
      steps.push({ turn, done: true, answer: choice.answer });
      return { state: 'succeeded', answer: choice.answer, steps };
    }
    const allowed = capabilities.some(c => c.key === choice.capability);
    if (!allowed) {
      // Asking for something it was not offered is a bug or an attempt, and
      // either way it does not get to happen.
      steps.push({ turn, refused: choice.capability, why: 'not offered to this harness' });
      seen.push({ capability: choice.capability, result: 'refused: not available to you' });
      continue;
    }
    try {
      const out = await invoke({ capability: choice.capability, input: choice.input ?? {} });
      steps.push({ turn, capability: choice.capability, verification: out.verification ?? null });
      seen.push({ capability: choice.capability, result: out.result ?? out.error ?? null });
    } catch (e) {
      steps.push({ turn, capability: choice.capability, error: e.message });
      seen.push({ capability: choice.capability, result: `error: ${e.message}` });
    }
  }
  return { state: 'failed', reason: `gave up after ${MAX_TURNS} turns`, steps };
}

const SYSTEM = `You act for a small business through a platform that records every
action. Choose one capability at a time from the list you are given. You may only
use capabilities on that list. When the goal is met, set done and answer.`;

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['done'],
  properties: {
    done: { type: 'boolean' },
    answer: { type: 'string' },
    capability: { type: 'string' },
    input: { type: 'object' },
    why: { type: 'string' },
  },
};

function prompt({ goal, capabilities, seen }) {
  return [
    `Goal: ${goal}`,
    '',
    'Capabilities available to you:',
    ...capabilities.map(c => `  ${c.key} — ${c.summary ?? ''}`),
    '',
    seen.length ? 'What has happened so far:' : 'Nothing has happened yet.',
    ...seen.map(s => `  ${s.capability} -> ${JSON.stringify(s.result)?.slice(0, 300)}`),
  ].join('\n');
}

function parse(output) {
  if (output && typeof output === 'object') return output.json ?? output;
  if (typeof output !== 'string') return null;
  try { return JSON.parse(output); } catch { return null; }
}
