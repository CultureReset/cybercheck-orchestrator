import path from 'node:path';
import * as db from './src/db.js';
import { loadPackages } from './src/kernel/registry.js';
import './src/kernel/canonical.js';
import './src/kernel/channels.js';
import { listCapabilities } from './src/kernel/policy.js';
import { listSlots } from './src/kernel/providers.js';

await db.connect({ schemaDir: path.resolve('db') });
console.log('1. db.connect + migrations           OK');

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
process.exit(0);
