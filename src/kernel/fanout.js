import { q, one, j } from '../db.js';
import { subscribe } from './events.js';
import { getCapability } from './policy.js';
import { listPackages } from './registry.js';
// Nobody tells the platform to update Facebook.
// A canonical value changes, and every installed app that carries that value
// gets a run queued against it. The owner never picks the destinations.
export async function fanOut({ ctx, key }) {
  const ws = await one(
    `select * from workspace where business_id = $1 and kind = 'cloud_android'`, [ctx.businessId]
  );
  if (!ws) return { queued: [] };
  const apps = await q(
    `select da.package_key from device_app da
      where da.workspace_id = $1 and da.logged_in = true`, [ws.id]
  );
  const { request } = await import('./executor.js');
  const queued = [];
  for (const app of apps) {
    const map = await one(
      `select carries, routes from appmap where package_key = $1 and status = 'active'
        order by created_at desc limit 1`, [app.package_key]
    );
    if (!map) continue;
    const carries = j(map.carries) ?? [];
    if (!carries.includes(key)) continue;
    const out = await request({
      ctx, capability: 'channel.push', input: { packageKey: app.package_key, key },
      resource: app.package_key,
    });
    queued.push({
      packageKey: app.package_key,
      state: out.execution?.state ?? 'error',
      verification: out.verification ?? null,
      error: out.error?.message ?? out.execution?.error ?? null,
    });
  }
  return { key, queued };
}
// Which canonical key a completed write touched is the capability's own
// business, not the kernel's.
//
// This was a two-entry table mapping capability name to key, which meant hours
// propagated and nothing else did — a package could carry a value to five apps
// and still watch its own writes go nowhere, because the kernel had never heard
// of it. A capability declares `canonicalKey` (defineLogicFunction validates it,
// compile() carries it into the manifest) and fan-out reads it back here.
//
// Same rule as defaultPriority on providers: the kernel asks, it does not know.
export function keyOfForTest(capabilityKey) { return keyOf(capabilityKey); }
function keyOf(capabilityKey) {
  const cap = getCapability(capabilityKey);
  if (cap?.canonicalKey) return cap.canonicalKey;
  // A capability from a compiled manifest carries its keys on the package.
  const pkg = listPackages().find(m => (m.capabilities ?? []).includes(capabilityKey));
  return pkg?.canonicalKeys?.[capabilityKey] ?? null;
}
export function installFanOut() {
  subscribe('execution.succeeded', async ({ businessId, payload }) => {
    const key = keyOf(payload.capability);
    if (!key) return;
    const ctx = await systemContext(businessId);
    await fanOut({ ctx, key });
  });
  // A plain fact change carries its own key.
  subscribe('canonical.fact_changed', async ({ businessId, payload }) => {
    const ctx = await systemContext(businessId);
    await fanOut({ ctx, key: payload.key });
  });
}
// Fan-out runs as the platform on the owner's behalf, so it is not blocked by
// the acting person's grants. It is still recorded and still receipted.
async function systemContext(businessId) {
  const business = await one(`select * from business where id = $1`, [businessId]);
  return {
    businessId, business, person: null,
    membership: { id: null, role: 'system' },
    system: true,
  };
}
