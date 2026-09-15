// Factory-side. Signs map bundles so a box will accept them.
//
// This runs in the shop and nowhere else. Nothing on a customer's machine signs
// anything; a box only ever verifies.
//
//   node scripts/sign-appmaps.mjs                     sign every bundle
//   node scripts/sign-appmaps.mjs google_business/542.0.3
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../src/db.js';
import { signMap, contentHash } from '../src/kernel/appmaps.js';

const root = path.resolve('appmaps');
const only = process.argv.slice(2);

await db.connect({ schemaDir: path.resolve('db') });

const bundles = [];
for (const pkg of fs.readdirSync(root, { withFileTypes: true })) {
  if (!pkg.isDirectory()) continue;
  for (const ver of fs.readdirSync(path.join(root, pkg.name), { withFileTypes: true })) {
    if (!ver.isDirectory()) continue;
    const rel = `${pkg.name}/${ver.name}`;
    if (only.length && !only.includes(rel)) continue;
    const file = path.join(root, rel, 'map.json');
    if (fs.existsSync(file)) bundles.push({ rel, file });
  }
}

if (!bundles.length) {
  console.error(only.length ? `no bundle matching ${only.join(', ')}` : 'no bundles found');
  process.exit(1);
}

for (const { rel, file } of bundles) {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  await signMap(map);
  console.log(`signed  ${rel.padEnd(34)} ${contentHash(map).slice(0, 16)}`);
}
console.log(`\n${bundles.length} bundle(s) signed.`);
