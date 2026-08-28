#!/usr/bin/env node
/**
 * Voice as a provider.
 *
 * The claim: what a caller can say is whatever the business has installed and
 * been granted — not a list in the code. A capability invented after this file
 * was written must be speakable, and one the caller lacks must not be.
 *
 * No network: the OpenAI call is stubbed at fetch.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as voice from '../modules/voice_openai/index.js';

let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};

process.env.OPENAI_API_KEY ||= 'test-key';

// Capture what the provider sends, and reply with whatever the test wants.
let sent = null;
const realFetch = globalThis.fetch;
const stub = (reply) => {
  globalThis.fetch = async (url, opts) => {
    sent = { url: String(url), body: JSON.parse(opts.body) };
    return { ok: true, json: async () => reply, text: async () => '' };
  };
};
const restore = () => { globalThis.fetch = realFetch; };

const caps = [
  { key: 'business.set_hours', summary: 'Replace the weekly hours.', input: { type: 'object', properties: { days: { type: 'array' } } } },
  { key: 'loyalty.redeem', summary: 'Spend points for a reward.' },
];
const picked = (name, args = {}) => ({
  choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } } ] } }],
});

/* ── the vocabulary is the grant list ────────────────────────────────────── */

await check('every granted capability is offered as a tool', async () => {
  stub(picked('business__set_hours'));
  await voice.intent({ transcript: 'open at nine tomorrow', capabilities: caps });
  restore();
  const names = sent.body.tools.map((t) => t.function.name).sort();
  assert.deepEqual(names, ['business__set_hours', 'loyalty__redeem']);
});

await check('a capability invented after this file was written is speakable', async () => {
  const invented = { key: 'dress_code.set', summary: 'Set tonight’s dress code.' };
  stub(picked('dress_code__set', { value: 'smart casual' }));
  const out = await voice.intent({ transcript: 'make tonight smart casual', capabilities: [...caps, invented] });
  restore();
  assert.equal(out.capability, 'dress_code.set');
  assert.deepEqual(out.input, { value: 'smart casual' });
});

await check('a capability not granted cannot be reached by talking', async () => {
  // The model names something real, but not on this caller's list.
  stub(picked('billing__cancel'));
  const out = await voice.intent({ transcript: 'cancel my subscription', capabilities: caps });
  restore();
  assert.equal(out.capability, null, 'an ungranted capability must not be returned');
  assert.match(out.say, /cannot do that one/);
});

await check('no capabilities means an honest answer, not a crash', async () => {
  const out = await voice.intent({ transcript: 'do something', capabilities: [] });
  assert.equal(out.capability, null);
  assert.match(out.say, /nothing I am allowed to do/);
});

await check('silence is not an action', async () => {
  const out = await voice.intent({ transcript: '   ', capabilities: caps });
  assert.equal(out.capability, null);
});

await check('no tool call returns the spoken reply instead of guessing', async () => {
  stub({ choices: [{ message: { content: 'I can change your hours or redeem points.' } }] });
  const out = await voice.intent({ transcript: 'what is the weather', capabilities: caps });
  restore();
  assert.equal(out.capability, null);
  assert.match(out.say, /change your hours/);
});

await check('the summary is what the model matches on', async () => {
  stub(picked('loyalty__redeem'));
  await voice.intent({ transcript: 'use my points', capabilities: caps });
  restore();
  const tool = sent.body.tools.find((t) => t.function.name === 'loyalty__redeem');
  assert.equal(tool.function.description, 'Spend points for a reward.');
});

/* ── sessions ────────────────────────────────────────────────────────────── */

await check('a call opens and closes', async () => {
  voice.openSession({ callId: 'c1' });
  assert.equal(voice.sessionCount(), 1);
  const out = voice.closeSession({ callId: 'c1' });
  assert.equal(voice.sessionCount(), 0);
  assert.ok(out.durationMs >= 0);
});

await check('closing a call that never opened is not an error', async () => {
  assert.deepEqual(voice.closeSession({ callId: 'nope' }), { durationMs: 0, turns: 0 });
});

/* ── the rule ────────────────────────────────────────────────────────────── */

await check('this provider names no capability', async () => {
  const src = readFileSync(new URL('../modules/voice_openai/index.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const named = code.match(/['"][a-z_]+\.[a-z_]+['"]/g) || [];
  const allowed = new Set(['"audio/wav"', "'audio/wav'", "'audio/mpeg'", '"audio/mpeg"']);
  const bad = named.filter((n) => !allowed.has(n) && !n.includes('/'));
  if (bad.length) throw new Error(`names a capability: ${bad.join(', ')}`);
});

await check('the manifest fills the voice slot and volunteers a default', async () => {
  const m = JSON.parse(readFileSync(new URL('../modules/voice_openai/manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.kind, 'provider');
  assert.equal(m.fills, 'voice');
  assert.ok(Number.isFinite(m.defaultPriority));
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log(`${passed} checks passed - what a caller can say is what they were granted, nothing more`);
