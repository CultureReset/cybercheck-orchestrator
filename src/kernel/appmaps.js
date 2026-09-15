import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, one, j } from '../db.js';
import { sign, verify } from './signing.js';
// The map channel.
//
// A map is not code and does not ship with a release. It is a signed bundle
// naming one app, one version of that app, the canonical keys it carries, and
// the steps to write and read each one. A box verifies the signature before it
// installs it, and installs it without restarting anything.
//
// That separation is the point: when Yelp moves a button, a new bundle goes out
// on this channel. Nothing else moves.
//
// Maps are authored in the shop, against a real device, by whatever tooling is
// slowest and smartest. Nothing here interprets anything — it loads what the
// shop signed.

// Signatures are namespaced so a map for a package can never be confused with
// a signature over the package's own code.
const signingKeyFor = (packageKey) => `map:${packageKey}`;

// The hash covers everything a box would act on. Change what the map claims to
// carry, or a single step, and the signature stops verifying.
export function contentHash(map) {
  return crypto.createHash('sha256').update(JSON.stringify({
    packageKey: map.packageKey,
    appVersion: map.appVersion,
    androidPackage: map.androidPackage,
    carries: map.carries,
    routes: map.routes,
  })).digest('hex');
}

function validate(map, origin) {
  const at = origin ? ` (${origin})` : '';
  for (const f of ['packageKey', 'appVersion', 'androidPackage', 'carries', 'routes']) {
    if (map[f] === undefined) throw new Error(`appmap missing ${f}${at}`);
  }
  if (!Array.isArray(map.carries)) throw new Error(`appmap carries must be a list${at}`);
  for (const key of map.carries) {
    const route = map.routes[key];
    if (!route) throw new Error(`appmap claims to carry "${key}" but has no route for it${at}`);
    if (!route.write && !route.read) throw new Error(`appmap route "${key}" does neither${at}`);
    // A write nobody reads back is a write nobody can trust. The verifier has
    // nothing to compare against, so the run can only ever report "unknown".
    if (route.write && !route.read) {
      throw new Error(`appmap route "${key}" writes but cannot read back${at}`);
    }
    for (const step of [...(route.write ?? []), ...(route.read ?? [])]) {
      assertStep(step, key, at);
    }
  }
  return map;
}

// The executor's whole vocabulary. A step naming anything else would fail on the
// device at the worst possible moment, so it fails here instead.
const STEP_KINDS = ['open', 'tap', 'type', 'read', 'expect', 'wait'];
function assertStep(step, key, at) {
  const kinds = Object.keys(step).filter(k => STEP_KINDS.includes(k));
  if (kinds.length !== 1) {
    throw new Error(`appmap route "${key}" has a step that is not one action: ${JSON.stringify(step)}${at}`);
  }
  if ('type' in step && !step.into) {
    throw new Error(`appmap route "${key}" types without naming a field${at}`);
  }
  // Elements are found by what they are — text, resource id, content description.
  // A map that carries pixel coordinates breaks on the next screen size, so it
  // is refused rather than shipped.
  for (const [k, v] of Object.entries(step)) {
    if (typeof v === 'number' && k !== 'wait') {
      throw new Error(`appmap route "${key}" locates "${k}" by number; find elements by name${at}`);
    }
  }
}

// Factory side. Sign a map so a box will accept it.
export async function signMap(map, { signer = 'culturereset', trustTier = 'first_party' } = {}) {
  validate(map);
  return sign({
    packageKey: signingKeyFor(map.packageKey),
    version: map.appVersion,
    contentHash: contentHash(map),
    signer,
    trustTier,
  });
}

// Box side. Install one map, but only if the shop signed exactly this content.
export async function installMap(map, { origin = null, requireSignature = true } = {}) {
  validate(map, origin);
  const hash = contentHash(map);
  if (requireSignature) {
    const sig = await verify({
      packageKey: signingKeyFor(map.packageKey),
      version: map.appVersion,
      contentHash: hash,
    });
    if (!sig.ok) throw new Error(`refusing appmap ${map.packageKey}@${map.appVersion}: ${sig.reason}`);
  }
  const row = await one(
    `insert into appmap (package_key, version, android_package, carries, routes, status)
     values ($1,$2,$3,$4::jsonb,$5::jsonb,'active')
     on conflict (package_key, version) do update set
       android_package = excluded.android_package,
       carries = excluded.carries,
       routes = excluded.routes,
       status = 'active'
     returning *`,
    [map.packageKey, map.appVersion, map.androidPackage,
     JSON.stringify(map.carries), JSON.stringify(map.routes)]
  );
  // A map that carries a key every box is now expected to keep in sync. Any
  // business already connected to this app starts tracking it, out of sync
  // until something reads the app and proves otherwise.
  await seedSyncState(map);
  return { appmap: row, contentHash: hash };
}

async function seedSyncState(map) {
  const conns = await q(
    `select id, business_id from connection where provider_key = $1 and status = 'connected'`,
    [map.packageKey]
  );
  for (const conn of conns) {
    for (const key of map.carries) {
      await q(
        `insert into channel_sync_state (business_id, connection_id, key, in_sync)
         values ($1,$2,$3,false)
         on conflict (connection_id, key) do nothing`,
        [conn.business_id, conn.id, key]
      );
    }
  }
}

// Read a catalog directory of bundles. One directory per app per app-version:
//
//   appmaps/<package_key>/<app version>/map.json
//
// Old versions stay. A box running an older build of an app keeps using the map
// that matches it, which is the whole reason the version is in the path.
export async function loadCatalog(dir, { requireSignature = true } = {}) {
  const installed = [];
  if (!fs.existsSync(dir)) return installed;
  for (const pkg of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const pkgDir = path.join(dir, pkg.name);
    for (const ver of fs.readdirSync(pkgDir, { withFileTypes: true })) {
      if (!ver.isDirectory()) continue;
      const file = path.join(pkgDir, ver.name, 'map.json');
      if (!fs.existsSync(file)) continue;
      const map = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rel = path.relative(dir, file);
      if (map.packageKey !== pkg.name || map.appVersion !== ver.name) {
        throw new Error(`appmap at ${rel} disagrees with its own path`);
      }
      const out = await installMap(map, { origin: rel, requireSignature });
      installed.push({ ...out, origin: rel });
    }
  }
  return installed;
}

// Which canonical keys the box can actually carry into the world right now.
// Anything an app holds but no map covers is work for the shop, not a failure.
export async function coverage(businessId) {
  const apps = await q(
    `select package_key, logged_in from device_app where business_id = $1 order by package_key`,
    [businessId]
  );
  const out = [];
  for (const app of apps) {
    const map = await one(
      `select version, carries from appmap where package_key = $1 and status = 'active'
        order by created_at desc limit 1`, [app.package_key]
    );
    out.push({
      packageKey: app.package_key,
      loggedIn: app.logged_in,
      mapVersion: map?.version ?? null,
      carries: map ? (j(map.carries) ?? []) : [],
      unmapped: !map,
    });
  }
  return out;
}
