// Describe what you want; get back a plan made only of things the platform can
// already do. The composer never invents a capability — a plan that references
// one the registry does not hold is rejected here rather than at install time,
// where it would have already been signed.
export async function plan({ intent, capabilities, packages, think }) {
  const known = new Set(capabilities.map(c => c.key));
  const answer = await think({
    need: 'reasoning',
    system: SYSTEM,
    schema: PLAN_SCHEMA,
    prompt: [
      `What the business asked for: ${intent}`,
      '',
      'Capabilities that exist:',
      ...capabilities.map(c => `  ${c.key} — ${c.summary ?? ''}`),
      '',
      'Packages installed:',
      ...packages.map(p => `  ${p.key} (${p.kind})`),
    ].join('\n'),
  });
  const proposed = parse(answer.output) ?? fallback(intent);
  const missing = (proposed.uses ?? []).filter(key => !known.has(key));
  return {
    ...proposed,
    uses: proposed.uses ?? [],
    missing,
    buildable: missing.length === 0,
  };
}

const SYSTEM = `You compose plans for a business platform. Use only the capabilities
listed. If the request needs something that does not exist, say so in "missing"
rather than inventing a capability name.`;

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'uses'],
  properties: {
    summary: { type: 'string' },
    uses: { type: 'array', items: { type: 'string' } },
    manifest: { type: 'object' },
    steps: { type: 'array', items: { type: 'object' } },
  },
};

function parse(output) {
  if (output && typeof output === 'object') return output.json ?? output;
  if (typeof output !== 'string') return null;
  try { return JSON.parse(output); } catch { return null; }
}

function fallback(intent) {
  return { summary: `Not planned: ${intent}`, uses: [], steps: [] };
}
