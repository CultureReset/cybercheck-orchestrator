// Bind a phone to a business, and switch that business onto it.
//
//   node scripts/attach-phone.mjs --business blue-crab --serial 1A2B3C4D
//
// Until this runs, the business executes against the simulator. After it, the
// same maps drive real glass — which is one row in provider_binding, and no
// change anywhere above the driver.
import { boot } from '../src/platform.js';
import { one } from '../src/db.js';
import { bind } from '../src/kernel/providers.js';
import { provision } from '../src/kernel/workspace.js';
import * as node from '../modules/android_local_node/index.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, [])
);
if (!args.business || !args.serial) {
  console.error('usage: node scripts/attach-phone.mjs --business <slug> --serial <serial>');
  process.exit(1);
}

await boot({ url: process.env.DATABASE_URL });
const business = await one(`select * from business where slug = $1`, [args.business]);
if (!business) throw new Error(`no business "${args.business}"`);

const workspace = await provision({ businessId: business.id });
const row = await node.register({
  workspaceId: workspace.id,
  businessId: business.id,
  serial: args.serial,
  endpoint: args.endpoint ?? process.env.DEVICED_ENDPOINT,
  transport: args.serial.includes(':') ? 'tcp' : 'usb',
});

await bind({ businessId: business.id, slot: 'workspace.executor', packageKey: 'android_local_node' });

const ready = await node.prepare({ workspace });
console.log(`phone ${row.serial} attached to ${business.display_name}`);
console.log(`  android ${ready.android_version ?? '?'}   endpoint ${row.endpoint}`);

const versions = await node.reconcileVersions({ workspace });
console.log(`  ${versions.checked} packages seen`);
for (const stale of versions.invalidated) {
  console.log(`  ! ${stale.package_key} v${stale.version} was proven against ` +
              `${stale.proven_version_code}, phone is running ${stale.now_running} ` +
              `— marked needs_revalidation`);
}
process.exit(0);
