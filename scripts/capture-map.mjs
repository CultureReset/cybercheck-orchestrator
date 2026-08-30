// What is actually on the screen right now.
//
//   node scripts/capture-map.mjs --serial <serial> [--package com.yelp.android.biz]
//
// Maps ship with their `desc` and `text` rungs filled in, because those are
// readable off the visible UI. The `id` rung has to come from a real phone.
// This prints them, so a map can stop depending on English button labels —
// which is what makes it survive a redesign and a locale change.
import { Adb } from '../src/drivers/adb.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, [])
);

if (!args.serial) {
  console.error('usage: node scripts/capture-map.mjs --serial <serial> [--package <pkg>]');
  process.exit(1);
}

const device = new Adb({ endpoint: args.endpoint ?? 'http://127.0.0.1:8391', serial: args.serial });

if (args.package) {
  await device.call('/open', { package: args.package, timeout_ms: 10000 });
}
const shot = await device.screenshot();

console.log();
console.log(`app          ${shot.app}`);
console.log(`activity     ${shot.activity}`);
console.log(`fingerprint  ${shot.fingerprint}`);
if (shot.challenge) {
  console.log(`challenge    ${shot.challenge}   <- automation cannot get past this`);
}
console.log();
console.log('resource-ids on screen:');
for (const id of shot.ids ?? []) console.log(`  ${id}`);
console.log();
console.log('Add the right one to the selector as its "id" rung:');
console.log('  { "id": "<from above>", "desc": "...", "text": "..." }');
