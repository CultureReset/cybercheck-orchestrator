import path from 'node:path';
import * as db from './src/db.js';
import { loadPackages } from './src/kernel/registry.js';
import './src/kernel/canonical.js';
import './src/kernel/channels.js';
import { listCapabilities } from './src/kernel/policy.js';
import { listSlots } from './src/kernel/providers.js';

await db.connect({ schemaDir: path.resolve('db') });
console.log('1. db.connect + 4 migrations           OK');

const tables = await db.q(
  `select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
console.log(`2. tables created                      ${tables.length}`);

const pkgs = await loadPackages(path.resolve('modules'));
console.log(`3. packages loaded                     ${pkgs.length}  [${pkgs.map(p => p.key).join(', ')}]`);

const caps = listCapabilities();
console.log(`4. capabilities registered             ${caps.length}`);
for (const c of caps) {
  const flags = [c.sensitivity && c.sensitivity !== 'normal' ? c.sensitivity : null,
                 c.agentSafe === false ? 'scriptOnly' : null].filter(Boolean).join(' ');
  console.log(`     ${c.key.padEnd(34)} ${c.route ?? ''} ${flags}`);
}
console.log(`5. slots declared                      ${listSlots().length}  [${listSlots().map(s => s.key).join(', ')}]`);

const caught = await db.q(`select key, sensitivity from capability order by key`);
console.log(`6. capabilities persisted to table     ${caught.length}`);

// Prove the safety loop end to end, with no packages involved.
const biz = await db.one(
  `insert into business (slug, display_name) values ('proof-co','Proof Co') returning *`);
const person = await db.one(
  `insert into person (email, display_name) values ('a@b.c','Owner') returning *`);
const mem = await db.one(
  `insert into membership (person_id, business_id, role) values ($1,$2,'owner') returning *`,
  [person.id, biz.id]);
console.log('7. business + person + membership      OK');

const { grant } = await import('./src/kernel/policy.js');
await grant({ businessId: biz.id, role: 'owner', capability: 'business.set_fact', disposition: 'auto' });
const ctx = { businessId: biz.id, business: biz, person, membership: mem };

const { request } = await import('./src/kernel/executor.js');
const out = await request({ ctx, capability: 'business.set_fact',
                            input: { key: 'contact.phone', value: '+1-251-555-0134' } });
console.log(`8. capability executed                 state=${out.execution.state} verification=${out.verification}`);

const { verifyChain } = await import('./src/kernel/ledger.js');
console.log('9. receipt chain                      ', JSON.stringify(await verifyChain(biz.id)));

// Denial path: a capability with no grant must be refused.
const denied = await request({ ctx, capability: 'business.set_hours', input: { days: [] } });
console.log(`10. ungranted capability               ${denied.error ? 'refused: ' + denied.error.message : 'ALLOWED — WRONG'}`);

// The L2 -> L4 seam: a canonical fact driven onto a device through an
// appmap, read back, and verified — the path that was previously never
// exercised end to end. No real phone here, but the same executor slot,
// the same contract, and the same channel.push/channel.read capabilities
// a real ADB-backed provider will run through unchanged.
const { registerGenerated } = await import('./src/kernel/registry.js');
const { installOnDevice, provision } = await import('./src/kernel/workspace.js');
const { bind } = await import('./src/kernel/providers.js');
await bind({ slot: 'workspace.executor', packageKey: 'android_cloud' });
registerGenerated({
  key: 'test_hours_app', version: '1.0.0', kind: 'channel_app', name: 'Test Hours App',
  androidPackage: 'com.test.hoursapp',
  carries: ['closing.tonight', 'broken.key'],
  routes: {
    'closing.tonight': {
      write: [{ open: 'com.test.hoursapp' }, { type: '{{value}}', into: 'closing_time' }],
      read: [{ open: 'com.test.hoursapp' }, { read: 'closing_time' }],
    },
    // Deliberately wrong field name, to prove a map mismatch is stopped and
    // filed rather than guessed at.
    'broken.key': {
      write: [{ open: 'com.test.hoursapp' }, { type: '{{value}}', into: 'no_such_field' }],
    },
  },
});
await grant({ businessId: biz.id, role: 'owner', capability: 'channel.push', disposition: 'auto' });
await grant({ businessId: biz.id, role: 'owner', capability: 'channel.read', disposition: 'auto' });
await provision({ businessId: biz.id });
await installOnDevice({
  businessId: biz.id, packageKey: 'test_hours_app', accountLabel: 'demo@proof.co',
  initialScreen: { closing_time: '21:00' },
});
console.log('11. workspace provisioned, app installed  OK  (prepare() ran against the executor slot)');

await request({ ctx, capability: 'business.set_fact', input: { key: 'closing.tonight', value: '20:00' } });
const pushed = await request({ ctx, capability: 'channel.push', input: { packageKey: 'test_hours_app', key: 'closing.tonight' } });
console.log(`12. channel.push (happy path)           state=${pushed.execution.state} verification=${pushed.verification}`);

await request({ ctx, capability: 'business.set_fact', input: { key: 'broken.key', value: 'x' } });
const broken = await request({ ctx, capability: 'channel.push', input: { packageKey: 'test_hours_app', key: 'broken.key' } });
console.log(`13. channel.push (map mismatch)         state=${broken.execution.state} verification=${broken.verification}`);
const repairs = await db.q(`select package_key, reason from repair_item where business_id = $1`, [biz.id]);
console.log(`14. repair queue                        ${repairs.length ? repairs.map(r => `${r.package_key}: ${r.reason}`).join('; ') : 'EMPTY — WRONG'}`);

process.exit(0);
