import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scoreField, rank, locate, hintsFor, patchRoute } from '../src/kernel/repair.js';
const ROUTE = {
  write: [
    { open: 'com.test.app' }, { tap: 'Hours' },
    { type: '{{value.opens}}', into: 'from' }, { type: '{{value.closes}}', into: 'to' },
    { tap: 'Save' },
  ],
  read: [{ open: 'com.test.app' }, { tap: 'Hours' }, { read: 'from' }, { read: 'to' }],
  assemble: { opens: 'from', closes: 'to' },
};
test('a field that kept its spelling scores on spelling', () => {
  assert.ok(scoreField({ target: 'from', field: 'from_time' }) >= 0.6);
  assert.ok(scoreField({ target: 'Hours', field: 'Business hours' }) >= 0.6);
});
test('a field that kept only its meaning scores on the value it carried', () => {
  assert.ok(scoreField({ target: 'from', hints: ['opens'], field: 'opens_at' }) >= 0.6);
  assert.ok(scoreField({ target: 'from', hints: ['opens'], field: 'closes_at' }) < 0.6);
});
test('an unrelated field scores low', () => {
  assert.ok(scoreField({ target: 'from', hints: ['opens'], field: 'phone_number' }) < 0.6);
});
test('rank refuses to pick when two fields score alike', () => {
  const tie = rank({ target: 'time', fields: ['time_one', 'time_two'] });
  assert.equal(tie.pick, null, 'a tie is not a decision');
  assert.equal(tie.candidates.length, 2);
});
test('rank picks a clear winner', () => {
  const out = rank({ target: 'from', hints: ['opens'], fields: ['opens_at', 'phone', 'address'] });
  assert.equal(out.pick, 'opens_at');
});
test('rank never picks a field the route already uses', () => {
  const out = rank({ target: 'from', hints: ['opens'], fields: ['opens_at', 'to'], exclude: ['to', 'opens_at'] });
  assert.equal(out.pick, null);
});
test('locate finds the step by the key that is never templated', () => {
  const found = locate({ routes: { hours: ROUTE }, step: { type: '07:00', into: 'from' } });
  assert.equal(found.key, 'hours');
  assert.equal(found.direction, 'write');
  assert.equal(found.target, 'from');
  assert.equal(found.step.type, '{{value.opens}}', 'the template comes back with it');
});
test('locate returns nothing for a step that is not in the map', () => {
  assert.equal(locate({ routes: { hours: ROUTE }, step: { into: 'nowhere' } }), null);
});
test('hints come from the placeholder the step was carrying', () => {
  assert.deepEqual(hintsFor({ type: '{{value.opens}}', into: 'from' }), ['opens']);
  assert.deepEqual(hintsFor({ tap: 'Save' }), []);
});
test('patching rewrites both directions and the assemble map', () => {
  const patched = patchRoute({ route: ROUTE, from: 'from', to: 'opens_at' });
  assert.equal(patched.write[2].into, 'opens_at');
  assert.equal(patched.read[2].read, 'opens_at');
  assert.deepEqual(patched.assemble, { opens: 'opens_at', closes: 'to' });
  assert.equal(patched.write[3].into, 'to', 'the other field is untouched');
  assert.equal(ROUTE.write[2].into, 'from', 'the original route is not mutated');
});
// --- the loop, against the device driver -------------------------------------
const HOURS = { opens: '07:00', closes: '22:00' };
const ANDROID_PACKAGE = 'com.test.app';
async function fixture() {
  const db = await import('../src/db.js');
  await import('../src/kernel/canonical.js');
  await import('../src/kernel/channels.js');
  const { loadPackages } = await import('../src/kernel/registry.js');
  const { bind } = await import('../src/kernel/providers.js');
  const { grant } = await import('../src/kernel/policy.js');
  const { provision } = await import('../src/kernel/workspace.js');
  const { deviceFor } = await import('../src/drivers/android.js');
  await db.connect({ schemaDir: path.resolve('db') });
  await loadPackages(path.resolve('modules'));
  await bind({ businessId: null, slot: 'workspace.executor', packageKey: 'android_local_node' });
  const biz = await db.one(`insert into business (slug, display_name) values ('repair-co','Repair Co') returning *`);
  const person = await db.one(`insert into person (email, display_name) values ('o@repair.co','Owner') returning *`);
  const mem = await db.one(
    `insert into membership (person_id, business_id, role) values ($1,$2,'owner') returning *`,
    [person.id, biz.id]);
  for (const cap of ['business.set_fact', 'channel.push']) {
    await grant({ businessId: biz.id, role: 'owner', capability: cap, disposition: 'auto' });
  }
  const ctx = { businessId: biz.id, business: biz, person, membership: mem };
  const ws = await provision({ businessId: biz.id });
  await db.one(
    `insert into appmap (package_key, version, android_package, carries, routes)
     values ('testapp','1.0.0',$1,'["hours"]'::jsonb,$2::jsonb) returning *`,
    [ANDROID_PACKAGE, JSON.stringify({ hours: ROUTE })]);
  await db.one(
    `insert into device_app (workspace_id, business_id, package_key, android_package, account_label, logged_in)
     values ($1,$2,'testapp',$3,'owner@test',true) returning *`,
    [ws.id, biz.id, ANDROID_PACKAGE]);
  const conn = await db.one(
    `insert into connection (business_id, provider_key, display_name, external_id)
     values ($1,'testapp','Test App','owner@test') returning *`, [biz.id]);
  await db.one(
    `insert into channel_sync_state (business_id, connection_id, key, in_sync)
     values ($1,$2,'hours',false) returning *`, [biz.id, conn.id]);
  const device = deviceFor(ws.id);
  device.installApp(ANDROID_PACKAGE, { Hours: '', from: '09:00', to: '17:00', Save: '' });
  device.login(ANDROID_PACKAGE, 'owner@test');
  const { request } = await import('../src/kernel/executor.js');
  await request({ ctx, capability: 'business.set_fact', input: { key: 'hours', value: HOURS } });
  return { db, ctx, ws, device, request, biz };
}
test('an app moves a field and the map is repaired', async (t) => {
  const { db, ctx, ws, device, request, biz } = await fixture();
  const { attempt, attemptAll, openItems } = await import('../src/kernel/repair.js');
  await t.test('the push lands while the map still matches', async () => {
    const out = await request({ ctx, capability: 'channel.push', input: { packageKey: 'testapp', key: 'hours' } });
    assert.equal(out.execution.state, 'succeeded');
    assert.equal(out.verification, 'verified');
    assert.equal(device.screenshot().screen.from, '07:00');
  });
  await t.test('the app renames a field and the push refuses to guess', async () => {
    device.renameField(ANDROID_PACKAGE, 'from', 'opens_at');
    const out = await request({ ctx, capability: 'channel.push', input: { packageKey: 'testapp', key: 'hours' } });
    assert.equal(out.execution.state, 'failed');
    assert.match(out.error.message, /appmap mismatch/);
    const queue = await openItems(biz.id);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].package_key, 'testapp');
    assert.deepEqual(JSON.parse(JSON.stringify(queue[0].step)), { type: '07:00', into: 'from' });
  });
  await t.test('repair finds the new field, proves it, and rewrites the map', async () => {
    const [item] = await openItems(biz.id);
    const out = await attempt({ ctx, repairItemId: item.id, useModel: false });
    assert.equal(out.repaired, true);
    assert.equal(out.pick, 'opens_at');
    assert.equal(out.decidedBy, 'score', 'the scores were clear enough that no model was needed');
    assert.deepEqual(out.readBack, HOURS, 'accepted only because the value came back off the screen');
    const map = await db.one(
      `select * from appmap where package_key = 'testapp' and status = 'active'`);
    assert.equal(map.version, '1.0.1');
    assert.match(map.note, /"from" -> "opens_at"/);
    const old = await db.one(`select * from appmap where package_key = 'testapp' and version = '1.0.0'`);
    assert.equal(old.status, 'superseded', 'the map it replaced is kept, not edited');
    assert.equal(map.derived_from, old.id);
  });
  await t.test('the repair closes the queue item with what it decided', async () => {
    assert.equal((await openItems(biz.id)).length, 0);
    const item = await db.one(`select * from repair_item where business_id = $1`, [biz.id]);
    assert.equal(item.state, 'resolved');
    assert.ok(item.resolved_at);
    const resolution = typeof item.resolution === 'string' ? JSON.parse(item.resolution) : item.resolution;
    assert.equal(resolution.from, 'from');
    assert.equal(resolution.to, 'opens_at');
    assert.equal(resolution.appmapVersion, '1.0.1');
  });
  await t.test('the next push uses the repaired map with no repair at all', async () => {
    device.screen = null;
    const out = await request({ ctx, capability: 'channel.push', input: { packageKey: 'testapp', key: 'hours' } });
    assert.equal(out.execution.state, 'succeeded');
    assert.equal(out.verification, 'verified');
    assert.equal((await openItems(biz.id)).length, 0);
  });
  await t.test('a field that moved to nothing recognisable is left open', async () => {
    device.renameField(ANDROID_PACKAGE, 'to', 'xyzzy');
    await request({ ctx, capability: 'channel.push', input: { packageKey: 'testapp', key: 'hours' } });
    const queue = await openItems(biz.id);
    assert.equal(queue.length, 1);
    const out = await attempt({ ctx, repairItemId: queue[0].id, useModel: false });
    assert.equal(out.repaired, false);
    assert.match(out.why, /no field on the screen matches "to"/);
    assert.equal((await openItems(biz.id)).length, 1, 'it stays in the queue');
  });
  await t.test('attemptAll works the queue without stopping on the one it cannot fix', async () => {
    const results = await attemptAll({ ctx, useModel: false });
    assert.equal(results.length, 1);
    assert.equal(results[0].repaired, false);
    assert.equal(results[0].packageKey, 'testapp');
  });
});
