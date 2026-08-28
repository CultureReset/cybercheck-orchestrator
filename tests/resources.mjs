#!/usr/bin/env node
/**
 * Packages that reference each other without importing each other.
 *
 * Ported from Huly's platform package. The three claims worth pinning:
 * ids never collide, nothing loads until asked, and a missing package fails
 * with the id in the message rather than taking the boot with it.
 */

import assert from 'node:assert/strict';
import { ids, parseId, provide, resolve, tryResolve, provided, reset } from '../src/kernel/resources.js';

let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};

await check('a shape becomes ids', () => {
  const hours = ids('hours', { capability: { set: '' }, renderer: { week: '' } });
  assert.equal(hours.capability.set, 'hours:capability:set');
  assert.equal(hours.renderer.week, 'hours:renderer:week');
});

await check('ids nest', () => {
  const x = ids('x', { a: { b: { c: '' } } });
  assert.equal(x.a.b.c, 'x:a:b:c');
});

await check('two packages cannot collide on a name', () => {
  assert.notEqual(ids('a', { capability: { set: '' } }).capability.set,
                  ids('b', { capability: { set: '' } }).capability.set);
});

await check('a bad package key is refused', () => {
  assert.throws(() => ids('Not A Key', { a: { b: '' } }), /bad package key/);
});

await check('a name containing the separator is refused', () => {
  assert.throws(() => ids('x', { 'a:b': { c: '' } }), /contains/);
});

await check('an id parses back', () => {
  assert.deepEqual(parseId('hours:capability:set'), { packageKey: 'hours', kind: 'capability', name: 'set' });
});

await check('a two-part string is not an id', () => {
  assert.throws(() => parseId('hours:set'), /not a resource id/);
});

/* ── nothing loads until something asks ──────────────────────────────────── */

reset();
let loads = 0;
provide('hours', async () => { loads += 1; return { capability: { set: () => 'set!' } }; });

await check('registering does not load', () => assert.equal(loads, 0));

await check('resolving loads once', async () => {
  const fn = await resolve('hours:capability:set');
  assert.equal(fn(), 'set!');
  assert.equal(loads, 1);
});

await check('resolving again does not reload', async () => {
  await resolve('hours:capability:set');
  assert.equal(loads, 1);
});

await check('simultaneous callers cause one load', async () => {
  reset(); loads = 0;
  provide('hours', async () => { loads += 1; return { capability: { set: () => 1 } }; });
  await Promise.all(Array.from({ length: 10 }, () => resolve('hours:capability:set')));
  assert.equal(loads, 1);
});

/* ── failures name the id ────────────────────────────────────────────────── */

await check('a missing package names the id, not a stack trace', async () => {
  await assert.rejects(() => resolve('deleted_package:capability:x'),
    /deleted_package:capability:x: no package "deleted_package" is registered/);
});

await check('a missing kind names the id', async () => {
  await assert.rejects(() => resolve('hours:renderer:week'), /exports no "renderer"/);
});

await check('a missing name names the id', async () => {
  await assert.rejects(() => resolve('hours:capability:nope'), /has no capability called "nope"/);
});

await check('a package that throws while loading does not poison the cache', async () => {
  reset();
  let attempts = 0;
  provide('flaky', async () => { attempts += 1; if (attempts === 1) throw new Error('disk'); return { capability: { go: () => 'ok' } }; });
  await assert.rejects(() => resolve('flaky:capability:go'), /loading "flaky" failed: disk/);
  assert.equal(await (await resolve('flaky:capability:go'))(), 'ok', 'a retry must be able to succeed');
});

await check('tryResolve returns null instead of throwing', async () => {
  assert.equal(await tryResolve('nothing:here:at_all'), null);
});

/* ── the point: one package uses another without importing it ────────────── */

await check('a package calls a peer it never imported', async () => {
  reset();
  // Written independently. Neither file mentions the other's module path.
  provide('profile', async () => ({ capability: { hours: () => '9 to 5' } }));
  provide('signage', async () => ({
    capability: {
      // The only thing signage knows about profile is a string from a manifest.
      render: async () => `Open ${await (await resolve('profile:capability:hours'))()}`,
    },
  }));
  const render = await resolve('signage:capability:render');
  assert.equal(await render(), 'Open 9 to 5');
});

await check('deleting the peer fails loudly at call time, not at boot', async () => {
  reset();
  provide('signage', async () => ({
    capability: { render: async () => (await resolve('profile:capability:hours'))() },
  }));
  const render = await resolve('signage:capability:render');   // signage still loads
  await assert.rejects(render, /no package "profile" is registered/);
  assert.deepEqual(provided(), ['signage']);
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log(`${passed} checks passed - packages reference each other by id, load lazily, fail by name`);
