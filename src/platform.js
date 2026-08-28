import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { loadPackages } from './kernel/registry.js';
import './kernel/canonical.js';  // registers kernel capabilities
import './kernel/channels.js';   // registers the android route capabilities
import { installFanOut } from './kernel/fanout.js';
import { bind } from './kernel/providers.js';
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export async function boot({ url } = {}) {
  await db.connect({ url, schemaDir: path.join(ROOT, 'db') });
  const packages = await loadPackages(path.join(ROOT, 'modules'));
  installFanOut();
  const bindings = await defaults();
  return { packages, bindings };
}
// A context is who is acting, on behalf of which business.
export async function contextFor({ personId, businessSlug }) {
  const business = await db.one(`select * from business where slug = $1`, [businessSlug]);
  if (!business) throw new Error(`no business "${businessSlug}"`);
  const person = personId ? await db.one(`select * from person where id = $1`, [personId]) : null;
  const membership = person
    ? await db.one(`select * from membership where person_id = $1 and business_id = $2 and status = 'active'`,
                   [person.id, business.id])
    : null;
  return { businessId: business.id, business, person, membership };
}
// Platform defaults. A business overrides any of these with one row.
//
// Each slot names its candidates in preference order and the first one actually
// installed wins. Two rules matter here:
//
//   A default naming an absent package is skipped, not fatal. A kernel that
//   refuses to start because an optional provider is missing is not a modular
//   kernel, and every package above this line is meant to be removable.
//
//   A default only applies when the slot is empty. Once anything is bound —
//   by an operator, by a demo, by a business — boot leaves it alone rather
//   than stomping the choice on every restart.
async function defaults() {
  const { bind: bindSlot } = await import('./kernel/providers.js');
  const { getPackage } = await import('./kernel/registry.js');
  const { q } = await import('./db.js');
  const preferences = [
    // The platform default is the executor that needs no hardware. A real
    // device is a per-business binding, because a business's phone holds that
    // business's logged-in accounts and is never shared.
    ['workspace.executor', ['android_cloud', 'android_simulator']],
    ['builder', ['composer']],
    ['harness', ['loop_harness']],
    ['model', ['hosted_models']],
  ];
  const bound = [];
  for (const [slot, candidates] of preferences) {
    const existing = await q(
      `select 1 from provider_binding where slot_key = $1 and business_id is null and active = true`,
      [slot]
    );
    if (existing.length > 0) continue;
    const packageKey = candidates.find(key => getPackage(key));
    if (!packageKey) continue;
    await bindSlot({ businessId: null, slot, packageKey,
                     config: slot === 'model' ? { simulate: true } : {} });
    bound.push({ slot, packageKey });
  }
  return bound;
}
