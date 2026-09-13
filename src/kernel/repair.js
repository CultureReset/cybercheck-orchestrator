import { q, one, j } from '../db.js';
import { resolve } from './providers.js';
import { route as routeModel } from './router.js';
import { androidWorkspace } from './workspace.js';
import { canonicalValue } from './channels.js';
import { emit } from './events.js';
// An app moved a field. The map that used to reach it now stops on a step whose
// target is not on the screen, and channel.push writes a repair_item instead of
// guessing at something nearby.
//
// This is what picks that item up:
//
//   read the live screen -> score every field on it -> pick one, or ask a model
//   to pick one -> run the patched route -> read it back -> keep the new map
//   only if the read-back matches canonical
//
// The read-back is the whole safety story. A proposed field is never trusted
// because it scored well or because a model liked it; it is trusted because
// the value came back off the screen afterwards.
const ACCEPT = 0.6;        // a candidate below this is not worth trying
const MARGIN = 0.15;       // and a winner must beat the runner-up by this much
// --- naming ------------------------------------------------------------------
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function tokens(s) {
  return String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function editDistance(a, b) {
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let k = 1; k <= b.length; k++) {
      row[k] = Math.min(prev[k] + 1, row[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return Math.max(0, 1 - editDistance(x, y) / Math.max(x.length, y.length));
}
// Three independent signals, and the strongest one wins. A renamed field
// usually keeps either its spelling ("from" -> "from_time"), its words
// ("Hours" -> "Business hours"), or the canonical subfield the step was
// carrying ({{value.opens}} -> "opens_at"). Any one of them is enough to try.
export function scoreField({ target, hints = [], field }) {
  const targetTokens = tokens(target);
  const fieldTokens = new Set(tokens(field));
  const shared = targetTokens.filter(t => fieldTokens.has(t)).length;
  const overlap = targetTokens.length ? shared / targetTokens.length : 0;
  const hinted = hints.some(h => fieldTokens.has(h)) ? 0.8 : 0;
  return Math.max(similarity(target, field), overlap, hinted);
}
export function rank({ target, hints = [], fields, exclude = [] }) {
  const scored = fields
    .filter(f => f !== target && !exclude.includes(f))
    .map(field => ({ field, score: Number(scoreField({ target, hints, field }).toFixed(3)) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  const clear = best && best.score >= ACCEPT && (!next || best.score - next.score >= MARGIN);
  return { candidates: scored.slice(0, 5), pick: clear ? best.field : null };
}
// --- locating the broken step ------------------------------------------------
// The step on the repair_item has already had its {{value}} placeholders filled,
// so the templates are gone. Find the same step in the map by the key that is
// never templated — the target — and the route's own wording comes back with it.
const targetOf = (step) => step?.into ?? step?.tap ?? step?.read ?? step?.expect ?? null;
export function locate({ routes, step }) {
  const target = targetOf(step);
  if (target === null) return null;
  for (const [key, route] of Object.entries(routes ?? {})) {
    for (const direction of ['write', 'read']) {
      const index = (route[direction] ?? []).findIndex(s => targetOf(s) === target);
      if (index !== -1) return { key, direction, index, target, step: route[direction][index] };
    }
  }
  return null;
}
// {{value.opens}} says the step was carrying the canonical subfield "opens".
// That is the best hint available about what the field is for.
export function hintsFor(step) {
  const out = new Set();
  for (const v of Object.values(step ?? {})) {
    if (typeof v !== 'string') continue;
    for (const m of v.matchAll(/\{\{value(?:\.([a-z0-9_]+))?\}\}/gi)) {
      if (m[1]) for (const t of tokens(m[1])) out.add(t);
    }
  }
  return [...out];
}
// Rewrite every reference to the old field, in both directions and in the
// assemble map, so a repaired route can still read back what it wrote.
export function patchRoute({ route, from, to }) {
  const swap = (steps) => (steps ?? []).map(s => {
    const out = { ...s };
    for (const field of ['into', 'tap', 'read', 'expect']) {
      if (out[field] === from) out[field] = to;
    }
    return out;
  });
  const patched = { ...route, write: swap(route.write), read: swap(route.read) };
  if (route.assemble) {
    patched.assemble = Object.fromEntries(
      Object.entries(route.assemble).map(([k, v]) => [k, v === from ? to : v])
    );
  }
  return patched;
}
// --- the loop ----------------------------------------------------------------
export async function openItems(businessId) {
  return q(
    `select * from repair_item where business_id = $1 and state = 'open'
      order by created_at`, [businessId]
  );
}
async function activeMap(packageKey) {
  return one(
    `select * from appmap where package_key = $1 and status = 'active'
      order by created_at desc limit 1`, [packageKey]
  );
}
// What the map expected, what is on the screen now, and which field the step
// most likely moved to. Changes nothing — safe to show in a dashboard.
export async function diagnose({ ctx, repairItemId }) {
  const item = await one(
    `select * from repair_item where id = $1 and business_id = $2`, [repairItemId, ctx.businessId]
  );
  if (!item) throw new Error('no such repair item');
  const map = await activeMap(item.package_key);
  if (!map) throw new Error(`no active appmap for ${item.package_key}`);
  const routes = j(map.routes) ?? {};
  const step = j(item.step);
  const found = locate({ routes, step });
  if (!found) return { item, map, located: null, reason: 'the failing step is not in the active map' };
  const ws = await androidWorkspace(ctx.businessId);
  const executor = await resolve({ slot: 'workspace.executor', businessId: ctx.businessId });
  if (!executor) throw new Error('no workspace executor bound');
  // The stored screenshot is evidence of the failure. Repair works against the
  // screen as it is now, which may have moved again since.
  const live = await executor.module.screenshot({ workspace: ws });
  const fields = Object.keys(live?.screen ?? {});
  const used = usedFields(routes[found.key]);
  const hints = hintsFor(found.step);
  const ranked = rank({ target: found.target, hints, fields, exclude: used });
  return { item, map, located: found, hints, screen: live, fields, ...ranked };
}
function usedFields(route) {
  const out = new Set();
  for (const step of [...(route?.write ?? []), ...(route?.read ?? [])]) {
    const t = targetOf(step);
    if (t !== null) out.add(t);
  }
  return [...out];
}
// Only reached when the scores do not name one field clearly. The model is
// given the list of fields that are actually on the screen and asked to choose
// one of them — it never writes a step, and a name it invents is discarded.
async function askModel({ ctx, target, hints, fields, packageKey }) {
  const prompt = `An Android app moved a field. The automation step targeted "${target}"`
    + (hints.length ? `, which carried the value "${hints.join(' ')}"` : '')
    + `. These fields are on the screen now: ${JSON.stringify(fields)}.`
    + ` Answer with one of those exact strings, or "none". Answer with the string only.`;
  try {
    const out = await routeModel({ ctx, task: { need: 'cheap', prompt } });
    const said = String(out.output ?? '').trim().replace(/^["']|["'],?$/g, '');
    const chosen = fields.find(f => f === said) ?? fields.find(f => norm(f) === norm(said)) ?? null;
    return { chosen, said, model: `${out.from}:${out.model}` };
  } catch (e) {
    return { chosen: null, said: null, error: e.message, packageKey };
  }
}
// Try the repair. Writes the canonical value through the patched route and
// reads it back; the new map is saved only if the read-back matches.
export async function attempt({ ctx, repairItemId, useModel = true }) {
  const found = await diagnose({ ctx, repairItemId });
  if (!found.located) return { ...found, repaired: false, why: found.reason };
  const { item, map, located, fields, hints } = found;
  let pick = found.pick;
  let decidedBy = pick ? 'score' : null;
  let asked = null;
  if (!pick && useModel) {
    asked = await askModel({ ctx, target: located.target, hints, fields, packageKey: item.package_key });
    pick = asked.chosen;
    decidedBy = pick ? 'model' : null;
  }
  if (!pick) {
    return { ...found, repaired: false, asked,
             why: `no field on the screen matches "${located.target}"` };
  }
  const routes = j(map.routes) ?? {};
  const patched = patchRoute({ route: routes[located.key], from: located.target, to: pick });
  const trial = await tryRoute({ ctx, packageKey: item.package_key, key: located.key, route: patched });
  if (!trial.ok) {
    await q(`update repair_item set resolution = $1::jsonb where id = $2`,
            [JSON.stringify({ tried: pick, decidedBy, failed: trial.why }), item.id]);
    return { ...found, repaired: false, pick, decidedBy, asked, trial,
             why: `"${pick}" did not read back the value that was written` };
  }
  const next = await saveMap({ map, key: located.key, route: patched, from: located.target, to: pick, decidedBy });
  await q(
    `update repair_item set state = 'resolved', resolved_at = now(), resolution = $1::jsonb
      where id = $2`,
    [JSON.stringify({ from: located.target, to: pick, decidedBy, appmapVersion: next.version,
                      readBack: trial.observed }), item.id]
  );
  await emit({ businessId: ctx.businessId, topic: 'appmap.repaired',
               payload: { packageKey: item.package_key, key: located.key,
                          from: located.target, to: pick, version: next.version } });
  return { ...found, repaired: true, pick, decidedBy, asked, appmap: next, readBack: trial.observed };
}
// Write the value the push was carrying anyway, then read it back. Nothing
// else is written, so a failed attempt costs one edit with the right value in
// it — not a wrong value, and not a value nobody asked for.
async function tryRoute({ ctx, packageKey, key, route }) {
  const value = await canonicalValue(ctx.businessId, key);
  if (value === null) return { ok: false, why: `no canonical value for "${key}"` };
  const ws = await androidWorkspace(ctx.businessId);
  const executor = await resolve({ slot: 'workspace.executor', businessId: ctx.businessId });
  try {
    await executor.module.run({ workspace: ws, steps: route.write.map(s => bindStep(s, value)) });
  } catch (e) {
    return { ok: false, why: `write failed: ${e.reason ?? e.message}` };
  }
  if (!route.read) return { ok: false, why: 'no read route to prove the write landed' };
  let observed;
  try {
    const { readings } = await executor.module.run({ workspace: ws, steps: route.read });
    observed = route.assemble
      ? Object.fromEntries(Object.entries(route.assemble).map(([f, src]) => [f, readings[src]]))
      : Object.values(readings)[0];
  } catch (e) {
    return { ok: false, why: `read failed: ${e.reason ?? e.message}` };
  }
  return { ok: same(observed, value), observed, expected: value,
           why: same(observed, value) ? null : 'read-back differs from canonical' };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The same placeholder filling channel.push does. Kept here rather than shared
// so a change to repair cannot quietly change what a normal push writes.
function bindStep(step, value) {
  const out = {};
  for (const [k, v] of Object.entries(step)) {
    out[k] = typeof v === 'string'
      ? v.replace(/\{\{value(?:\.([a-z0-9_]+))?\}\}/gi, (_, f) => String(f ? value?.[f] ?? '' : value))
      : v;
  }
  return out;
}
// A repaired map is a new version, not an edit. The one it replaced stays in
// the table, marked superseded, so a bad repair can be read back to it.
async function saveMap({ map, key, route, from, to, decidedBy }) {
  const routes = { ...(j(map.routes) ?? {}), [key]: route };
  const version = await nextVersion(map.package_key, map.version);
  await q(`update appmap set status = 'superseded' where id = $1`, [map.id]);
  return one(
    `insert into appmap (package_key, version, android_package, carries, routes, status, derived_from, note)
     values ($1,$2,$3,$4::jsonb,$5::jsonb,'active',$6,$7) returning *`,
    [map.package_key, version, map.android_package, JSON.stringify(j(map.carries) ?? []),
     JSON.stringify(routes), map.id, `${key}: "${from}" -> "${to}" (by ${decidedBy})`]
  );
}
async function nextVersion(packageKey, current) {
  const parts = String(current ?? '1.0.0').split('.').map(n => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  for (let patch = parts[2] + 1; patch < parts[2] + 200; patch++) {
    const candidate = `${parts[0]}.${parts[1]}.${patch}`;
    const taken = await one(`select 1 from appmap where package_key = $1 and version = $2`,
                            [packageKey, candidate]);
    if (!taken) return candidate;
  }
  throw new Error(`no free version after ${current} for ${packageKey}`);
}
// Work the queue. Each item is independent; one that cannot be repaired does
// not stop the next.
export async function attemptAll({ ctx, useModel = true }) {
  const out = [];
  for (const item of await openItems(ctx.businessId)) {
    try {
      const result = await attempt({ ctx, repairItemId: item.id, useModel });
      out.push({ id: item.id, packageKey: item.package_key, repaired: result.repaired,
                 pick: result.pick ?? null, decidedBy: result.decidedBy ?? null, why: result.why ?? null });
    } catch (e) {
      out.push({ id: item.id, packageKey: item.package_key, repaired: false, why: e.message });
    }
  }
  return out;
}
