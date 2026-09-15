import { q, one } from '../db.js';
import { defineCapability } from './policy.js';
import { resolve } from './providers.js';
import { androidWorkspace } from './workspace.js';

// The other way an app gets a map.
//
// installOnDevice() writes an appmap row from a manifest a person authored.
// That does not scale past a handful of platforms — every one of the thirty
// two in the capability catalog would need someone to hand-write which label
// on which screen holds which canonical key.
//
// This does the same job by reading a screen the app is already showing.
// Point it at an app that is open and logged in, tell it which canonical keys
// you are looking for and what their field might be called, and it matches
// what it sees against that and proposes a route.
//
// It never writes to the app — only channel.push does that, and only from a
// map a person has promoted. What this produces is inert: the same shape
// channel.push already expects, sitting in the same table, with status
// 'candidate' instead of 'active'. See appmap.promote below.
//
// It does not invent navigation. `entry` is the steps to reach the screen
// being explored — the same step vocabulary routes are already written in.
// Finding screens is a harder, separate problem; this solves the one that
// was pure manual labor: naming the fields once you are looking at them.

function normalize(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

defineCapability({
  key: 'channel.explore',
  packageKey: 'kernel',
  summary: 'Read one screen of an installed app and propose an appmap for it.',
  route: 'android',
  // Read-only against the device, same as channel.read — it looks at a
  // screen and proposes, it never taps or types into the app.
  agentSafe: true,
  deterministic: true,
  handler: async ({ ctx, input }) => {
    const { packageKey, entry = [], hints } = input;
    if (!hints || typeof hints !== 'object' || !Object.keys(hints).length) {
      throw new Error('channel.explore needs hints: { canonicalKey: [candidate label, ...] }');
    }
    const ws = await androidWorkspace(ctx.businessId);
    if (!ws) throw new Error('no android workspace');
    const app = await one(
      `select * from device_app where workspace_id = $1 and package_key = $2`, [ws.id, packageKey]
    );
    if (!app) throw new Error(`${packageKey} is not installed on this device`);
    if (!app.logged_in) throw new Error(`${packageKey} is not logged in`);
    const executor = await resolve({ slot: 'workspace.executor', businessId: ctx.businessId });
    if (!executor) throw new Error('no workspace executor bound');

    const { screen } = await executor.module.run({ workspace: ws, steps: [{ open: app.android_package }, ...entry] });
    const fields = Object.keys(screen);
    const byNormalized = new Map(fields.map((f) => [normalize(f), f]));

    const carries = [];
    const routes = {};
    const matched = {};
    const unmatched = [];
    for (const [key, labels] of Object.entries(hints)) {
      const list = Array.isArray(labels) ? labels : [labels];
      const field = list.map(String).find((l) => fields.includes(l))
        ?? list.map((l) => byNormalized.get(normalize(l))).find(Boolean);
      if (!field) {
        unmatched.push(key);
        continue;
      }
      carries.push(key);
      matched[key] = field;
      routes[key] = {
        read: [{ open: app.android_package }, ...entry, { read: field }],
        write: [{ open: app.android_package }, ...entry, { type: '{{value}}', into: field }],
      };
    }

    const prior = await one(
      `select version from appmap where package_key = $1 and status = 'active'
        order by created_at desc limit 1`, [packageKey]
    );
    const row = await one(
      `insert into appmap (package_key, version, android_package, carries, routes,
                            status, discovered_by, evidence)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,'candidate','explorer',$6::jsonb)
       returning *`,
      [packageKey, `explore-${Date.now()}`, app.android_package,
       JSON.stringify(carries), JSON.stringify(routes),
       JSON.stringify({ screen, matched, unmatched, basedOnVersion: prior?.version ?? null })]
    );
    return { packageKey, candidateVersion: row.version, carries, unmatched };
  },
  verify: async ({ result }) => ({
    state: result.unmatched.length ? 'partial' : 'verified',
    evidence: [
      { kind: 'note', text: `matched ${result.carries.length} key(s), ${result.unmatched.length} unmatched` },
    ],
  }),
});

// Nothing the explorer proposes is trusted until a person looks at it and
// says so. This is the only thing that moves a candidate to active — the
// same "nothing deploys itself" rule the marketplace applies to a submitted
// product version.
defineCapability({
  key: 'appmap.promote',
  packageKey: 'kernel',
  summary: 'Make a candidate appmap the active one for its package.',
  route: 'internal',
  sensitivity: 'sensitive',
  agentSafe: false,
  handler: async ({ input }) => {
    const { packageKey, version } = input;
    const candidate = await one(
      `select * from appmap where package_key = $1 and version = $2 and status = 'candidate'`,
      [packageKey, version]
    );
    if (!candidate) throw new Error(`no candidate appmap for ${packageKey} @ ${version}`);
    await q(`update appmap set status = 'retired' where package_key = $1 and status = 'active'`, [packageKey]);
    return one(`update appmap set status = 'active' where id = $1 returning *`, [candidate.id]);
  },
});
