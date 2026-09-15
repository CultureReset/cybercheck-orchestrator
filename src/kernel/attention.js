import { q } from '../db.js';
// Needs Attention.
//
// Everything the owner has to act on converges here, in one list, in their
// words. They never learn which subsystem produced an item — a map that drifted,
// an expired login and a failed verification are all just things to fix.
//
// This is composed in the kernel rather than in the shell on purpose: the kernel
// is what knows an approval is pending or a map stopped matching, and composing
// it anywhere else would mean a second place that decides what is wrong.
//
// Severity is about the owner's day, not about the stack:
//   blocking  nothing else moves until they do something
//   waiting   the system is asking permission
//   degraded  it still works, but something is not carrying
const ORDER = { blocking: 0, waiting: 1, degraded: 2 };
export async function attention(businessId) {
  const items = [];
  // Waiting on a yes or no.
  for (const a of await q(
    `select a.id, a.execution_id, a.asked_at, e.capability
       from approval a join execution e on e.id = a.execution_id
      where a.business_id = $1 and a.decided_at is null
      order by a.asked_at`, [businessId])) {
    items.push({
      kind: 'approval', severity: 'waiting', at: a.asked_at,
      title: `${a.capability.replace(/\./g, ' ')} is waiting for you`,
      detail: 'Nothing happens until you approve it.',
      actions: ['Approve', 'Reject'], ref: { executionId: a.execution_id, approvalId: a.id },
    });
  }
  // An app moved a button. The write stopped rather than guessing.
  for (const r of await q(
    `select package_key, reason, created_at from repair_item
      where business_id = $1 and state = 'open' order by created_at desc`, [businessId])) {
    items.push({
      kind: 'repair', severity: 'blocking', at: r.created_at,
      title: `${r.package_key} changed and we stopped`,
      detail: 'Nothing was written. We are fixing the map; this clears itself when the fix arrives.',
      actions: [], ref: { packageKey: r.package_key, reason: r.reason },
    });
  }
  // An app the owner has to sign back into. Only they can do this.
  for (const d of await q(
    `select package_key, account_label from device_app
      where business_id = $1 and logged_in = false`, [businessId])) {
    items.push({
      kind: 'signin', severity: 'blocking', at: null,
      title: `${d.package_key} needs you to sign in again`,
      detail: 'Open it on the phone and sign in. We never ask for the password.',
      actions: ['Fix'], ref: { packageKey: d.package_key },
    });
  }
  // Somewhere the world does not match what the owner said is true.
  for (const s of await q(
    `select s.key, c.provider_key, s.last_checked from channel_sync_state s
       join connection c on c.id = s.connection_id
      where s.business_id = $1 and s.in_sync = false`, [businessId])) {
    items.push({
      kind: 'drift', severity: 'degraded', at: s.last_checked,
      title: `${s.provider_key} is not showing your ${s.key.replace(/[._]/g, ' ')}`,
      detail: 'We will try again. Nothing you need to do yet.',
      actions: ['Review'], ref: { key: s.key, packageKey: s.provider_key },
    });
  }
  items.sort((a, b) => (ORDER[a.severity] - ORDER[b.severity])
    || (new Date(b.at ?? 0) - new Date(a.at ?? 0)));
  return { count: items.length, items };
}
