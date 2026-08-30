import { q, one, j } from '../db.js';
import { route } from './router.js';
import { listCapabilities, resolveDisposition } from './policy.js';
import { request } from './executor.js';
import { keyTouchedBy, appsCarrying } from './fanout.js';
// One sentence in, one structured job out.
//
// Two jobs, kept apart on purpose. Transcription turns sound into text and its
// responsibility ends there. Interpretation turns text into a capability call,
// chosen from a closed set — the capabilities this person could invoke by hand,
// and no others. A model that can only pick from a list cannot invent a verb.
//
// Nothing executes off the back of interpretation. A misheard number carried to
// five platforms is a far worse afternoon than one extra tap, so the owner sees
// what was understood, and which apps it will reach, before anything moves.

export async function interpret({ ctx, transcript, surface = 'text', audioSeconds = null }) {
  const offered = await offerable(ctx);
  if (offered.length === 0) throw new Error('this person may not invoke anything');

  const answer = await route({
    ctx,
    task: {
      need: 'reasoning',
      system: SYSTEM,
      schema: schemaFor(offered),
      prompt: promptFor({ transcript, offered }),
    },
  });
  const parsed = parse(answer.output) ?? {};
  const capability = offered.some(c => c.key === parsed.capability) ? parsed.capability : null;

  const row = await one(
    `insert into intent_log (business_id, person_id, surface, transcript, audio_seconds,
                             capability, input, confidence, state)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'proposed') returning *`,
    [ctx.businessId, ctx.person?.id ?? null, surface, transcript, audioSeconds,
     capability, JSON.stringify(parsed.input ?? {}), parsed.confidence ?? null]
  );

  if (!capability) {
    return { intent: row, understood: false, question: parsed.question ?? 'I did not understand that.' };
  }
  // Which apps this will reach. The owner never picks destinations — but being
  // shown them is the difference between a confirmation and a leap of faith.
  const key = keyTouchedBy(capability);
  const willTouch = key ? await appsCarrying({ businessId: ctx.businessId, key }) : [];

  return {
    intent: row,
    understood: true,
    capability,
    input: parsed.input ?? {},
    confidence: parsed.confidence ?? null,
    willTouch,
    confirmation: sentence({ parsed, willTouch }),
  };
}

// The owner said yes. Only now does anything happen, and it happens through the
// same executor, the same grants and the same receipts as a dashboard click.
export async function confirm({ ctx, intentId }) {
  const row = await one(
    `select * from intent_log where id = $1 and business_id = $2`, [intentId, ctx.businessId]
  );
  if (!row) throw new Error('no such intent');
  if (row.state !== 'proposed') throw new Error(`intent is ${row.state}`);
  if (!row.capability) throw new Error('nothing was understood to confirm');

  await q(`update intent_log set state = 'confirmed' where id = $1`, [row.id]);
  const out = await request({ ctx, capability: row.capability, input: j(row.input) ?? {} });
  await q(
    `update intent_log set state = 'executed', execution_id = $1 where id = $2`,
    [out.execution?.id ?? null, row.id]
  );
  return out;
}

export async function reject({ ctx, intentId }) {
  return one(
    `update intent_log set state = 'rejected' where id = $1 and business_id = $2 returning *`,
    [intentId, ctx.businessId]
  );
}

export async function history(businessId, limit = 50) {
  return q(
    `select surface, transcript, capability, state, created_at from intent_log
      where business_id = $1 order by created_at desc limit ${Number(limit)}`,
    [businessId]
  );
}

// --- the closed set ----------------------------------------------------------

// Exactly what this person could do by hand. A capability they have no grant
// for is not offered, so the model cannot propose it and the owner cannot be
// talked into confirming it.
async function offerable(ctx) {
  const out = [];
  for (const cap of listCapabilities()) {
    const disposition = await resolveDisposition({
      businessId: ctx.businessId, membership: ctx.membership,
      capability: cap.key, system: ctx.system === true,
    });
    if (disposition !== 'never') out.push(cap);
  }
  return out;
}

function schemaFor(offered) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['capability'],
    properties: {
      capability: { type: 'string', enum: [...offered.map(c => c.key), 'none'] },
      input: { type: 'object' },
      confidence: { type: 'number' },
      restated: { type: 'string' },
      question: { type: 'string' },
    },
  };
}

const SYSTEM = `You turn what a small business owner said into one capability call.

Pick a capability from the list, or "none" if nothing fits — "none" is the right
answer far more often than a bad guess, because a wrong guess gets carried to
every platform the business is on.

Times are 24-hour. "Ten tonight" is 22:00. "We're closing early" without a time
is not a time; ask.

Set "restated" to what you understood, in the owner's own plain words, not in
schema terms. They are going to read it back before anything happens.`;

function promptFor({ transcript, offered }) {
  return [
    `What they said: "${transcript}"`,
    '',
    'Capabilities you may choose from:',
    ...offered.map(c => `  ${c.key} — ${c.summary ?? ''}`),
  ].join('\n');
}

function sentence({ parsed, willTouch }) {
  const what = parsed.restated ?? 'that change';
  if (willTouch.length === 0) return `${what} — send it?`;
  return `${what}, on ${list(willTouch)} — send it?`;
}

function list(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function parse(output) {
  if (output && typeof output === 'object') return output.json ?? output;
  if (typeof output !== 'string') return null;
  try { return JSON.parse(output); } catch { return null; }
}
