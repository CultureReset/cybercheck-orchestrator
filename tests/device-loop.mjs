// Proves the device path end to end on the simulator executor:
//
//   provision -> install a channel app -> push a canonical value onto the
//   device -> read it back off the screen -> verified; then break the app's
//   UI and prove the same push fails into the repair queue instead of
//   reporting success.
//
// The channel app here is a fixture, not a shipped appmap. Real appmaps for
// real products belong in their own channel_app packages, mapped from the
// platform capability catalog — never invented in a test.

import assert from 'node:assert/strict';
import { boot, contextFor } from '../src/platform.js';
import { q, one } from '../src/db.js';
import { registerGenerated } from '../src/kernel/registry.js';
import { bind } from '../src/kernel/providers.js';
import { provision, installOnDevice } from '../src/kernel/workspace.js';
import { request } from '../src/kernel/executor.js';

const FIXTURE = {
  key: 'fixture_channel',
  version: '1.0.0',
  kind: 'channel_app',
  name: 'Fixture Channel',
  androidPackage: 'com.example.fixture',
  carries: ['contact.phone'],
  routes: {
    'contact.phone': {
      write: [
        { open: 'com.example.fixture' },
        { tap: 'Edit' },
        { type: '{{value}}', into: 'phone' },
        { tap: 'Save' },
        { expect: 'Saved' },
      ],
      read: [
        { open: 'com.example.fixture' },
        { read: 'phone' },
      ],
    },
  },
};

const results = [];
const check = (name, fn) => results.push([name, fn]);

await boot();

// A business, an owner, and the grant that lets the owner act.
const business = await one(
  `insert into business (slug, display_name) values ('fixture-marina','Fixture Marina') returning *`
);
const person = await one(
  `insert into person (email, display_name) values ('owner@fixture.test','Owner') returning *`
);
await one(
  `insert into membership (person_id, business_id, role) values ($1,$2,'owner') returning *`,
  [person.id, business.id]
);
// Grants name capabilities one at a time. There is no wildcard: absence of a
// grant is a denial, so a test has to ask for exactly what it uses.
for (const capability of ['business.set_fact', 'channel.push', 'channel.read']) {
  await q(
    `insert into grant_row (business_id, role, capability, resource, disposition)
     values ($1,'owner',$2,'*','auto')`,
    [business.id, capability]
  );
}

const ctx = await contextFor({ personId: person.id, businessSlug: 'fixture-marina' });

// The simulator fills the executor slot for this business.
await bind({ businessId: business.id, slot: 'workspace.executor', packageKey: 'android_simulator' });

const ws = await provision({ businessId: business.id });
registerGenerated(FIXTURE);
await installOnDevice({
  businessId: business.id,
  packageKey: 'fixture_channel',
  accountLabel: 'Fixture Marina',
  initialScreen: { Edit: '', phone: '', Save: '', Saved: '' },
});

// The canonical value the channel is supposed to carry.
await request({ ctx, capability: 'business.set_fact', input: { key: 'contact.phone', value: '251-555-0134' } });

check('a canonical value pushes onto the device and verifies', async () => {
  const res = await request({
    ctx, capability: 'channel.push',
    input: { packageKey: 'fixture_channel', key: 'contact.phone' },
  });
  assert.ok(!res.error, `push errored: ${res.error?.message}`);
  assert.equal(res.verification, 'verified', `expected verified, got ${res.verification}`);
});

check('the read-back is recorded as that channel\'s own observation', async () => {
  const obs = await one(
    `select * from observation where business_id = $1 and source = 'fixture_channel' and key = 'contact.phone'
      order by observed_at desc limit 1`, [business.id]
  );
  assert.ok(obs, 'no observation recorded');
  assert.match(JSON.stringify(obs.value), /251-555-0134/);
});

check('sync state falls out of the comparison', async () => {
  const row = await one(
    `select s.* from channel_sync_state s
       join connection c on c.id = s.connection_id
      where c.business_id = $1 and c.provider_key = 'fixture_channel' and s.key = 'contact.phone'`,
    [business.id]
  );
  assert.equal(row.in_sync, true, 'expected in_sync after a verified push');
});

check('a renamed field fails into the repair queue, not into success', async () => {
  const { deviceFor } = await import('../src/drivers/android.js');
  deviceFor(ws.id).renameField('com.example.fixture', 'phone', 'phone_number');

  const res = await request({
    ctx, capability: 'channel.push',
    input: { packageKey: 'fixture_channel', key: 'contact.phone' },
  });

  assert.ok(res.error, 'a broken appmap must not report success');
  assert.match(res.error.message, /appmap mismatch/);
  assert.equal(res.verification, 'failed');

  const repair = await one(
    `select * from repair_item where business_id = $1 and package_key = 'fixture_channel'
      order by created_at desc limit 1`, [business.id]
  );
  assert.ok(repair, 'nothing reached the repair queue');
  assert.ok(repair.screen, 'the repair item carries no screen evidence');
});

check('every consequential run left a receipt', async () => {
  const receipts = await q(`select * from receipt where business_id = $1`, [business.id]);
  assert.ok(receipts.length > 0, 'no receipts written');
});

let failed = 0;
for (const [name, fn] of results) {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
