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
// `modulesDir` exists so a test can boot the kernel with no packages at all
// and prove it still starts. Nothing in production passes it.
export async function boot({ url, modulesDir } = {}) {
  await db.connect({ url, schemaDir: path.join(ROOT, 'db') });
  const packages = await loadPackages(modulesDir ?? path.join(ROOT, 'modules'));
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
// This function names no package, no vendor and no slot, and it must not start
// doing so. A provider that is willing to be a platform default says so in its
// own manifest — `defaultPriority`, lower wins, with an optional
// `defaultConfig`. A provider that declares neither is never bound
// automatically, which is how hardware stays an explicit, per-business choice.
//
// Two rules follow from that:
//
//   A slot with no willing candidate is skipped, not fatal. A kernel that
//   refuses to start because an optional provider is missing is not a modular
//   kernel, and every package above this line is meant to be removable.
//
//   A slot that already has a binding is left alone. Once anything is bound —
//   by an operator, by a demo, by a business — boot does not stomp the choice
//   on the next restart.
async function defaults() {
  const { bind: bindSlot, listSlots } = await import('./kernel/providers.js');
  const { listPackages } = await import('./kernel/registry.js');
  const { q } = await import('./db.js');
  const bound = [];
  for (const slot of listSlots()) {
    const existing = await q(
      `select 1 from provider_binding where slot_key = $1 and business_id is null and active = true`,
      [slot.key]
    );
    if (existing.length > 0) continue;
    const [candidate] = listPackages()
      .filter(m => m.kind === 'provider'
                && m.fills === slot.key
                && Number.isFinite(m.defaultPriority))
      .sort((a, b) => a.defaultPriority - b.defaultPriority);
    if (!candidate) continue;
    await bindSlot({ businessId: null, slot: slot.key, packageKey: candidate.key,
                     config: candidate.defaultConfig ?? {} });
    bound.push({ slot: slot.key, packageKey: candidate.key });
  }
  return bound;
}
