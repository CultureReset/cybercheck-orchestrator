// The business's own phone, on the box, over ADB.
//
// This is the seam the whole architecture was built around. Everything above
// src/drivers/ speaks in steps; this file is where a step becomes a real touch
// on real glass. It exports the same three functions as android_cloud, so
// which one a business uses is one row in provider_binding.
import { q, one, j } from '../../src/db.js';
import { Adb } from '../../src/drivers/adb.js';
import { attachDevice } from '../../src/drivers/android.js';

const nodes = new Map();   // workspaceId -> Adb

async function nodeRow(workspaceId) {
  const row = await one(
    `select * from device_node where workspace_id = $1 order by created_at desc limit 1`,
    [workspaceId]
  );
  if (!row) throw new Error('no phone is registered against this workspace');
  return row;
}

async function deviceFor(workspaceId) {
  if (nodes.has(workspaceId)) return nodes.get(workspaceId);
  const row = await nodeRow(workspaceId);
  const device = new Adb({ endpoint: row.endpoint, serial: row.serial });
  nodes.set(workspaceId, device);
  attachDevice(workspaceId, device);
  return device;
}

// Register a phone against a workspace. Called once, when the box first sees it.
export async function register({ workspaceId, businessId, serial, endpoint, transport = 'usb' }) {
  const row = await one(
    `insert into device_node (workspace_id, business_id, serial, endpoint, transport, state, last_seen)
     values ($1,$2,$3,coalesce($4,'http://127.0.0.1:8391'),$5,'ready', now())
     on conflict (serial) do update set workspace_id = excluded.workspace_id,
       business_id = excluded.business_id, endpoint = excluded.endpoint,
       transport = excluded.transport, state = 'ready', last_seen = now()
     returning *`,
    [workspaceId, businessId, serial, endpoint ?? null, transport]
  );
  nodes.delete(workspaceId);
  return row;
}

export async function prepare({ workspace }) {
  const device = await deviceFor(workspace.id);
  const health = await device.health();
  const out = await device.prepare();
  await q(
    `update device_node set state = 'ready', last_seen = now(),
            android_version = $1, battery_level = $2
      where workspace_id = $3`,
    [health.android_version ?? null, health.battery_level ?? null, workspace.id]
  );
  return { ready: true, kind: 'adb', serial: device.serial, ...out };
}

// The prints for the app this route belongs to, so { at: "hours_editor" }
// has something to check against. Learned prints from a first run are written
// back, which is how a new map captures its screens instead of refusing to move.
async function printsFor(packageKey) {
  if (!packageKey) return { prints: {}, version: null };
  const map = await one(
    `select version from appmap where package_key = $1 and status = 'active'
      order by created_at desc limit 1`, [packageKey]
  );
  if (!map) return { prints: {}, version: null };
  const rows = await q(
    `select name, fingerprint from screen_print where package_key = $1 and version = $2`,
    [packageKey, map.version]
  );
  return {
    prints: Object.fromEntries(rows.map(r => [r.name, r.fingerprint])),
    version: map.version,
  };
}

export async function run({ workspace, steps, onStep, packageKey = null }) {
  const device = await deviceFor(workspace.id);
  const { prints, version } = await printsFor(packageKey);
  await q(`update device_node set state = 'busy' where workspace_id = $1`, [workspace.id]);
  try {
    const out = await device.run(steps, { onStep, prints });
    if (version && out.learned) {
      for (const [name, fingerprint] of Object.entries(out.learned)) {
        await one(
          `insert into screen_print (package_key, version, name, fingerprint)
           values ($1,$2,$3,$4)
           on conflict (package_key, version, name) do nothing returning *`,
          [packageKey, version, name, fingerprint]
        );
      }
    }
    return out;
  } finally {
    device.learned = {};
    await q(`update device_node set state = 'ready', last_seen = now() where workspace_id = $1`,
            [workspace.id]);
  }
}

export async function screenshot({ workspace }) {
  const device = await deviceFor(workspace.id);
  return device.screenshot();
}

// What build of each app is actually on the phone. A versionCode that moved
// invalidates every map for that package until it is proven again — this is
// the most common way a working system starts quietly writing wrong data.
export async function reconcileVersions({ workspace }) {
  const device = await deviceFor(workspace.id);
  const node = await nodeRow(workspace.id);
  const installed = await device.call('/packages');
  const invalidated = [];
  for (const app of installed.packages ?? []) {
    await one(
      `insert into app_version_seen (device_node_id, android_package, version_code, version_name)
       values ($1,$2,$3,$4)
       on conflict (device_node_id, android_package, version_code)
         do update set last_seen = now() returning *`,
      [node.id, app.package, String(app.version_code), app.version_name ?? null]
    );
    const stale = await q(
      `update appmap set status = 'needs_revalidation'
        where android_package = $1 and status = 'active'
          and proven_version_code is not null
          and proven_version_code <> $2
        returning package_key, version, proven_version_code`,
      [app.package, String(app.version_code)]
    );
    for (const row of stale) {
      invalidated.push({ ...row, now_running: String(app.version_code) });
    }
  }
  return { checked: installed.packages?.length ?? 0, invalidated };
}
