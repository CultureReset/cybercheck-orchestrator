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

// --- the map channel ---------------------------------------------------------
// Up to here every map rode inside a package manifest. That is the development
// path. The real one: maps are signed in the shop, shipped as bundles on their
// own channel, and verified by the box before anything installs. The packages
// below declare no routes at all — they only say the app is on the device.
const { loadCatalog, installMap, coverage } = await import('./src/kernel/appmaps.js');
const { signMap } = await import('./src/kernel/appmaps.js');
const { fanOut } = await import('./src/kernel/fanout.js');
const fs = await import('node:fs');

const catalogDir = path.resolve('appmaps');
const bundles = [];
for (const pkg of fs.readdirSync(catalogDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
  for (const ver of fs.readdirSync(path.join(catalogDir, pkg.name), { withFileTypes: true }).filter(e => e.isDirectory())) {
    bundles.push(JSON.parse(fs.readFileSync(path.join(catalogDir, pkg.name, ver.name, 'map.json'), 'utf8')));
  }
}
for (const m of bundles) await signMap(m);
const installedMaps = await loadCatalog(catalogDir);
console.log(`15. signed map catalog loaded           ${installedMaps.length}  [${installedMaps.map(m => m.origin.replace('/map.json', '')).join(', ')}]`);

// A map the shop did not sign, or one altered after signing, is refused.
const tampered = structuredClone(bundles[0]);
tampered.routes.hours.write.push({ tap: 'Confirm' });
let refused = null;
try { await installMap(tampered); } catch (e) { refused = e.message; }
console.log(`16. altered map refused                 ${refused ?? 'ACCEPTED — WRONG'}`);

// Three destinations on the device. Two have maps in the catalog. The third
// does not, which is work for the shop rather than a failure on the box.
for (const [key, androidPackage, name, screen] of [
  ['google_business', 'com.google.android.apps.vega', 'Google Business Profile',
   { Profile: 1, Hours: 1, opens_at: '09:00', closes_at: '17:00', Save: 1, Saved: 1 }],
  ['facebook_pages', 'com.facebook.pages.app', 'Facebook Pages',
   { 'Edit Page': 1, Hours: 1, opens_at: '09:00', closes_at: '17:00', 'Save Changes': 1, 'Changes saved': 1 }],
  ['yelp_business', 'com.yelp.android.biz', 'Yelp for Business', { Hours: 1 }],
]) {
  registerGenerated({ key, version: '1.0.0', kind: 'channel_app', name, androidPackage, carries: [], routes: {} });
  await installOnDevice({ businessId: biz.id, packageKey: key, accountLabel: 'demo@proof.co', initialScreen: screen });
}
const cover = await coverage(biz.id);
const unmapped = cover.filter(c => c.unmapped).map(c => c.packageKey);
console.log(`17. device apps / mapped / unmapped     ${cover.length} / ${cover.filter(c => !c.unmapped).length} / ${unmapped.join(', ') || 'none'}`);

// The whole promise, mechanically: one fact changes, every destination that
// carries it is queued. Nobody named Google or Facebook.
await request({ ctx, capability: 'business.set_fact',
                input: { key: 'hours', value: { opens_at: '11:00', closes_at: '20:00' } } });
const fanned = await fanOut({ ctx, key: 'hours' });
console.log(`18. fan-out on one fact change          queued=${fanned.queued.length}`);
for (const d of fanned.queued) {
  console.log(`     ${d.packageKey.padEnd(20)} ${d.state.padEnd(10)} ${d.verification ?? ''}${d.error ? '  ' + d.error : ''}`);
}

// An app moves a button. The write stops and is filed; nothing is guessed at,
// and the other destinations are unaffected.
const { deviceFor } = await import('./src/drivers/android.js');
const ws = await db.one(`select * from workspace where business_id = $1 and kind = 'cloud_android'`, [biz.id]);
deviceFor(ws.id).renameField('com.facebook.pages.app', 'closes_at', 'closing_time');
const afterDrift = await fanOut({ ctx, key: 'hours' });
const drifted = afterDrift.queued.filter(d => d.state !== 'succeeded').map(d => d.packageKey);
const stillFine = afterDrift.queued.filter(d => d.state === 'succeeded').map(d => d.packageKey);
console.log(`19. one map drifts                     broken=[${drifted.join(', ')}] unaffected=[${stillFine.join(', ')}]`);
const queue = await db.q(`select package_key, reason from repair_item where business_id = $1 order by created_at`, [biz.id]);
console.log(`20. repair queue after drift           ${queue.map(r => `${r.package_key}: ${r.reason}`).join('; ')}`);

// --- the L1 contract ---------------------------------------------------------
// What the shell reads before it talks to the kernel at all, and the one list
// the owner actually sees.
const { interfaceReport } = await import('./src/kernel/interface.js');
const { attention } = await import('./src/kernel/attention.js');
const iface = interfaceReport();
console.log(`21. kernel interface declared          ${iface.version}`);

// Something only the owner can fix, to prove it reaches the same list.
await db.q(`update device_app set logged_in = false where business_id = $1 and package_key = 'yelp_business'`, [biz.id]);
const needs = await attention(biz.id);
console.log(`22. needs attention                    ${needs.count}`);
for (const i of needs.items) console.log(`     ${i.severity.padEnd(9)} ${i.title}`);

process.exit(0);
