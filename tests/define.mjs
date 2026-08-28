#!/usr/bin/env node
/**
 * The ported define layer, end to end.
 *
 * Proves the three claims the port is worth making:
 *
 *   1. a declared object compiles to a manifest this kernel already accepts
 *   2. a bad definition reports every problem at once, and never reaches the DB
 *   3. a package can add a field to an object it does not own
 *
 * No database, no network.
 */

import {
  FieldType, definePackage, defineObject, defineField,
  defineLogicFunction, defineRole, defineIndex, defineConnectionProvider,
} from '../src/define/index.js';
import { compile } from '../src/define/compile.js';
import { DefinitionError } from '../src/define/result.js';

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failures.push(`${name}: expected ${e}, got ${a}`);
};
const ok = (name, cond) => check(name, Boolean(cond), true);

/* ── 1. a real package, declared ─────────────────────────────────────────── */

const LOYALTY = '9f3c1a2e-4b5d-4e6f-8a91-0c2d3e4f5a6b';
const CARD_NAME = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const CARD_POINTS = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const manifest = compile({
  package: definePackage({
    key: 'loyalty',
    version: '1.0.0',
    name: 'Loyalty',
    summary: 'Punch cards that survive the customer losing the paper one.',
  }),
  objects: [defineObject({
    universalIdentifier: LOYALTY,
    name: 'loyalty_card',
    label: 'Loyalty card',
    labelIdentifier: CARD_NAME,
    fields: [
      { universalIdentifier: CARD_NAME, name: 'holder', label: 'Holder', type: FieldType.TEXT, required: true },
      { universalIdentifier: CARD_POINTS, name: 'points', label: 'Points', type: FieldType.INT, default: 0 },
    ],
  })],
  functions: [defineLogicFunction({
    universalIdentifier: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
    name: 'redeem',
    summary: 'Spend points for a reward.',
    trigger: { on: 'manual' },
    canonicalKey: 'loyalty_balance',
  })],
  indexes: [defineIndex({
    universalIdentifier: 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80',
    object: 'loyalty_card', fields: ['holder'], unique: true,
  })],
  connections: [defineConnectionProvider({
    universalIdentifier: 'e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091',
    name: 'square', auth: 'oauth2',
  })],
  roles: [defineRole({
    universalIdentifier: 'f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f809102',
    label: 'Counter staff', capabilities: ['loyalty.redeem'],
  })],
});

check('key', manifest.key, 'loyalty');
check('kind defaults to app', manifest.kind, 'app');
check('object became schema', Object.keys(manifest.schema), ['loyalty_card']);
check('fields carried', Object.keys(manifest.schema.loyalty_card.fields), ['holder', 'points']);
check('field type is one installer.js can emit', manifest.schema.loyalty_card.fields.points.type, 'int');
check('required carried', manifest.schema.loyalty_card.fields.holder.required, true);
check('default carried', manifest.schema.loyalty_card.fields.points.default, 0);
check('free CRUD + declared verb',
  manifest.capabilities.sort(),
  ['loyalty.create', 'loyalty.list', 'loyalty.redeem', 'loyalty.remove', 'loyalty.update']);
check('canonical key declared by the capability, not the kernel',
  manifest.canonicalKeys, { 'loyalty.redeem': 'loyalty_balance' });
check('trigger carried', manifest.triggers.length, 1);
ok('no publicActions when nothing is public', manifest.publicActions === undefined);

/* ── 2. the manifest is one registry.js already accepts ──────────────────── */

const { default: registryModule } = await import('../src/kernel/registry.js')
  .then((m) => ({ default: m }));
// registerGenerated runs the kernel's own validate() and builds the module.
const mod = registryModule.registerGenerated(manifest);
ok('kernel accepted the compiled manifest', Array.isArray(mod.capabilities));
check('kernel generated four verbs from the schema', mod.capabilities.length, 4);
check('and they are namespaced', mod.capabilities.map(c => c.key).sort(),
  ['loyalty.create', 'loyalty.list', 'loyalty.remove', 'loyalty.update']);

/* ── 3. a field on an object this package does not own ───────────────────── */

const extended = compile({
  package: definePackage({ key: 'reviews', version: '1.0.0', name: 'Reviews', summary: 'Ratings.' }),
  fields: [defineField({
    universalIdentifier: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
    objectUniversalIdentifier: LOYALTY,      // loyalty's table, not ours
    name: 'accepts_walk_ins', label: 'Accepts walk-ins', type: FieldType.BOOLEAN, default: false,
  })],
});
check('foreign field is not in our schema', extended.schema, undefined);
check('it is declared as an extension', extended.extendsObjects.length, 1);
check('naming the object it reaches into', extended.extendsObjects[0].objectUniversalIdentifier, LOYALTY);

/* ── 4. every problem at once, and nothing reaches the database ──────────── */

let raised = null;
try {
  compile({
    package: definePackage({ key: 'Bad Key!', version: '', name: '', summary: '' }),
    objects: [defineObject({
      universalIdentifier: 'not-a-uuid',
      name: '9nope',
      label: '',
      fields: [
        { name: 'business_id', label: 'Tenant', type: FieldType.UUID, universalIdentifier: '11111111-1111-4111-8111-111111111111' },
        { name: 'ok', label: 'Ok', type: 'rocketship', universalIdentifier: '22222222-2222-4222-8222-222222222222' },
        { name: 'ok', label: 'Dup', type: FieldType.TEXT, universalIdentifier: '33333333-3333-4333-8333-333333333333' },
      ],
    })],
  });
} catch (err) { raised = err; }

ok('a bad definition throws', raised instanceof DefinitionError);
ok('it reports many problems, not one', raised.errors.length >= 7);
ok('including the tenancy column', raised.errors.some(e => e.includes('business_id')));
ok('including the unknown type', raised.errors.some(e => e.includes('rocketship')));
ok('including the duplicate name', raised.errors.some(e => e.includes('twice')));
ok('including the bad key', raised.errors.some(e => e.includes('key matching')));

/* ── report ──────────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  x ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`${passed} checks passed - ported define layer compiles to a manifest this kernel already runs`);
