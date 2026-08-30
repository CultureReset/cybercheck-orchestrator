import { q, one, j } from '../db.js';
import { route } from './router.js';
import { resolve } from './providers.js';
import { androidWorkspace } from './workspace.js';
import { emit } from './events.js';
// An app moved. The map that used to drive it no longer matches the screen.
//
// This is the only place a model is allowed near an appmap, and even here it
// does not get to act: it reads a screen it was handed, proposes a route, and
// the route is replayed read-only before anybody approves a write. One repair
// produces one new map version, and every business with that app gets it.
//
//   fail closed -> explore read-only -> dry-run the read path
//               -> a human approves -> promote a new version
//
// Never an edit in place. When it breaks again you want to diff what changed.

export async function open(businessId) {
  return q(
    `select * from repair_item where business_id = $1 and state = 'open'
      order by created_at desc`, [businessId]
  );
}

export async function get(businessId, id) {
  return one(`select * from repair_item where id = $1 and business_id = $2`, [id, businessId]);
}

// Step one: look, and only look. The model is handed the screen the run died on
// and the ladder that failed, and asked for a replacement route. It cannot
// touch the phone from here — there is no device in scope.
export async function propose({ ctx, repairItemId }) {
  const item = await get(ctx.businessId, repairItemId);
  if (!item) throw new Error('no such repair item');
  const map = await activeMap(item.package_key);
  if (!map) throw new Error(`no active map for ${item.package_key}`);

  const routes = j(map.routes) ?? {};
  const key = keyOfFailingRoute(routes, j(item.step));
  const screen = j(item.screen) ?? {};

  const answer = await route({
    ctx,
    task: {
      need: 'reasoning',
      system: SYSTEM,
      schema: ROUTE_SCHEMA,
      prompt: promptFor({ item, map, routes, key, screen }),
    },
  });
  const proposal = parse(answer.output);
  if (!proposal?.write && !proposal?.read) {
    throw new Error('the model proposed no usable route');
  }
  reject_coordinates(proposal);

  const merged = { ...routes };
  merged[key] = { ...(routes[key] ?? {}), ...proposal };

  return one(
    `update repair_item set proposed_routes = $1::jsonb, state = 'proposed'
      where id = $2 returning *`,
    [JSON.stringify(merged), item.id]
  );
}

// Step two: replay the proposed READ path, and nothing else.
//
// If the route cannot even find the value it is meant to change, it is wrong,
// and finding that out has cost one navigation and zero writes to a live
// business account.
export async function dryRun({ ctx, repairItemId }) {
  const item = await get(ctx.businessId, repairItemId);
  if (!item?.proposed_routes) throw new Error('nothing proposed for this repair item');
  const routes = j(item.proposed_routes);
  const key = keyOfFailingRoute(routes, j(item.step));
  const read = routes[key]?.read;
  if (!read) throw new Error(`the proposed route for "${key}" has no read path to test`);

  const ws = await androidWorkspace(ctx.businessId);
  const executor = await resolve({ slot: 'workspace.executor', businessId: ctx.businessId });
  if (!executor) throw new Error('no workspace executor bound');

  try {
    const { readings } = await executor.module.run({
      workspace: ws, steps: read, packageKey: item.package_key,
    });
    const found = Object.values(readings).filter(v => v !== undefined && v !== null && v !== '');
    if (found.length === 0) {
      return failDryRun(item.id, 'the read path ran but returned nothing');
    }
    return {
      item: await one(`update repair_item set state = 'dry_run_passed' where id = $1 returning *`, [item.id]),
      readings,
    };
  } catch (e) {
    return failDryRun(item.id, e.message);
  }
}

async function failDryRun(id, reason) {
  return {
    item: await one(
      `update repair_item set state = 'dry_run_failed', reason = $1 where id = $2 returning *`,
      [reason, id]
    ),
    error: reason,
  };
}

// Step three: a person approves, and the repair becomes a new map version.
//
// The approval is the point. A model proposed this route by looking at one
// screen; the first time it drives a write into a live Google Business Profile,
// somebody who is accountable for that listing has said yes.
export async function promote({ ctx, repairItemId }) {
  if (!ctx.person?.id) {
    throw new Error('a repaired map is promoted by a person, not by the platform');
  }
  const item = await get(ctx.businessId, repairItemId);
  if (!item) throw new Error('no such repair item');
  if (item.state !== 'dry_run_passed') {
    throw new Error(`repair is ${item.state}; it must pass a dry run before promotion`);
  }
  const current = await activeMap(item.package_key);
  const version = nextVersion(current?.version ?? '1.0.0');

  const promoted = await one(
    `insert into appmap (package_key, version, android_package, carries, routes,
                         status, source, repaired_from, approved_by, proven_version_code)
     values ($1,$2,$3,$4::jsonb,$5::jsonb,'active','repaired',$6,$7,$8) returning *`,
    [item.package_key, version, current?.android_package ?? null,
     JSON.stringify(j(current?.carries) ?? []), JSON.stringify(j(item.proposed_routes)),
     current?.id ?? null, ctx.person.id, current?.proven_version_code ?? null]
  );
  if (current) {
    await q(`update appmap set status = 'superseded', superseded_by = $1 where id = $2`,
            [promoted.id, current.id]);
  }
  // The prints belong to the old version's screens. The next run learns the
  // new ones rather than checking against a layout that no longer exists.
  await q(
    `update repair_item set state = 'resolved', resolved_at = now(), resulting_appmap_id = $1
      where id = $2`, [promoted.id, item.id]
  );
  await emit({
    businessId: ctx.businessId, topic: 'appmap.repaired',
    payload: { packageKey: item.package_key, version, from: current?.version ?? null },
  });
  return promoted;
}

// --- helpers -----------------------------------------------------------------

async function activeMap(packageKey) {
  return one(
    `select * from appmap where package_key = $1 and status = 'active'
      order by created_at desc limit 1`, [packageKey]
  );
}

// Which canonical key's route the failing step belongs to.
function keyOfFailingRoute(routes, step) {
  const wanted = JSON.stringify(step);
  for (const [key, route] of Object.entries(routes)) {
    for (const side of ['write', 'read']) {
      if ((route?.[side] ?? []).some(s => JSON.stringify(s) === wanted)) return key;
    }
  }
  return Object.keys(routes)[0];
}

function nextVersion(version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return `${version}-repaired`;
  return [parts[0], parts[1], parts[2] + 1].join('.');
}

// A proposal that reaches for a coordinate is refused outright. It would work
// once, on this phone, at this font size, and be silently wrong everywhere
// else — including on the same phone after the owner changes their display size.
function reject_coordinates(proposal) {
  const text = JSON.stringify(proposal);
  if (/"(x|y|bounds|coords?)"\s*:/.test(text)) {
    throw new Error('proposed route uses coordinates; selectors must name elements');
  }
}

const SYSTEM = `You repair UI automation maps for Android business apps.

You are shown a step that failed, every identifier it tried, and the elements
actually on screen. Propose a replacement route.

Rules you may not break:
- Every element is named by resource-id, content-description and visible text
  together, in that order of preference. Never by coordinates.
- Prefer resource-ids from the list of ids actually on the screen.
- Keep the { at: "<screen name>" } guards. They are what stops a blind tap on
  an unexpected screen.
- The read path must end by reading the same values the old one read, under the
  same "as" names, or verification stops working.
- Change as little as possible. If one selector moved, fix that selector.`;

const SELECTOR = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    desc: { type: 'string' },
    text: { type: 'string' },
  },
};
const STEP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    open: { type: 'string' },
    at: { type: 'string' },
    tap: SELECTOR,
    type: { type: 'string' },
    into: SELECTOR,
    read: SELECTOR,
    as: { type: 'string' },
    expect: SELECTOR,
    back: { type: 'boolean' },
    wait: { type: 'number' },
  },
};
const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['write', 'read'],
  properties: {
    write: { type: 'array', items: STEP },
    read: { type: 'array', items: STEP },
    assemble: { type: 'object' },
    why: { type: 'string' },
  },
};

function promptFor({ item, map, routes, key, screen }) {
  const ids = screen.ids ?? Object.keys(screen.screen ?? {});
  return [
    `App: ${item.package_key} (${map.android_package ?? 'unknown package'}) version ${map.version}`,
    `Canonical key being carried: ${key}`,
    '',
    `The step that failed: ${JSON.stringify(j(item.step))}`,
    `Why: ${item.reason}`,
    `Identifiers it tried: ${JSON.stringify(j(item.tried) ?? [])}`,
    item.expected_fingerprint
      ? `Expected screen print ${item.expected_fingerprint}, found ${item.observed_fingerprint}`
      : `Screen print at failure: ${item.observed_fingerprint ?? 'unknown'}`,
    '',
    'Elements actually on the screen:',
    ...ids.slice(0, 200).map(id => `  ${id}`),
    '',
    'The route as it stands:',
    JSON.stringify(routes[key], null, 2),
  ].join('\n');
}

function parse(output) {
  if (output && typeof output === 'object') return output.json ?? output;
  if (typeof output !== 'string') return null;
  try { return JSON.parse(output); } catch { return null; }
}
