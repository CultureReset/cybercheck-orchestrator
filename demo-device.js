// One sentence from an owner, carried to every app that holds the same fact,
// and read back off each screen to prove it landed.
//
//   node demo-device.js
//
// Runs against the simulator, so it needs no phone, no key and no network. The
// same code paths drive a real phone: swapping android_cloud for
// android_local_node is one row in provider_binding.
import { boot, contextFor } from './src/platform.js';
import { q, one, j } from './src/db.js';
import { grant } from './src/kernel/policy.js';
import { request } from './src/kernel/executor.js';
import { provision, installOnDevice } from './src/kernel/workspace.js';
import { drift } from './src/kernel/canonical.js';
import { drain } from './src/kernel/events.js';
import { deviceFor } from './src/drivers/android.js';
import * as repair from './src/kernel/repair.js';
import * as intent from './src/kernel/intent.js';

const SCREENS = {
  google_business: {
    'Edit profile': 'open', 'Business hours': 'open', 'Phone number': '(251) 555-0130',
    'Opening time': '11:00', 'Closing time': '21:00', Save: 'save', Saved: 'yes',
  },
  facebook: {
    'Your Page': 'open', 'Edit details': 'open', Hours: 'open', 'Phone number': '(251) 555-0130',
    'Open time': '11:00', 'Close time': '21:00', Save: 'save', 'Changes saved': 'yes',
  },
  yelp: {
    'Business Information': 'open', Hours: 'open',
    Opens: '11:00', Closes: '21:00', Save: 'save', Updated: 'yes',
  },
};

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(66));

async function main() {
  await boot();
  line();
  rule();
  line('  GHOST — one update, everywhere, verified');
  rule();

  const person = await one(
    `insert into person (email, display_name) values ($1,$2) returning *`,
    ['owner@thebluecrab.test', 'Dana']
  );
  const business = await one(
    `insert into business (slug, display_name) values ($1,$2) returning *`,
    ['blue-crab', 'The Blue Crab']
  );
  const membership = await one(
    `insert into membership (person_id, business_id, role) values ($1,$2,'owner') returning *`,
    [person.id, business.id]
  );
  for (const capability of ['business.set_fact', 'channel.read', 'business.set_hours']) {
    await grant({ businessId: business.id, membershipId: membership.id, capability, disposition: 'auto' });
  }
  const ctx = await contextFor({ personId: person.id, businessSlug: 'blue-crab' });

  const workspace = await provision({ businessId: business.id });
  for (const [key, screen] of Object.entries(SCREENS)) {
    await installOnDevice({ businessId: business.id, packageKey: key,
                            accountLabel: 'The Blue Crab', initialScreen: screen });
  }
  line();
  line(`  ${business.display_name} — 3 apps installed and signed in on their own phone`);
  line('  Every one of them holds a copy of "hours". None of them agree by accident.');

  // ---- 1. the owner says one thing ----------------------------------------
  line();
  rule();
  line('  1  "We are closing at 10 tonight."');
  rule();
  const said = await intent.interpret({ ctx, transcript: 'We are closing at 10 tonight.', surface: 'voice' });
  line();
  line(`     transcript -> intent_log ${said.intent.id.slice(0, 8)}`);
  line(`     understood: ${said.understood}`);
  if (!said.understood) {
    line('     (no model key bound, so nothing was interpreted — the fact is set directly below)');
  }

  // ---- 2. one canonical write ---------------------------------------------
  line();
  rule();
  line('  2  One canonical value is set. Nobody names a destination.');
  rule();
  await request({
    ctx, capability: 'business.set_fact',
    input: { key: 'hours', value: { opens: '11:00', closes: '22:00' } },
  });
  line();
  line('     business_fact.hours = { opens: 11:00, closes: 22:00 }');

  await settle();

  // ---- 3. what fan-out did ------------------------------------------------
  line();
  rule();
  line('  3  Fan-out ran on its own. Every app carrying "hours" got a run.');
  rule();
  await board(business.id);

  // ---- 4. the app moves ---------------------------------------------------
  line();
  rule();
  line('  4  Yelp redesigns. "Closes" becomes "Closing time".');
  rule();
  deviceFor(workspace.id).renameField('com.yelp.android.biz', 'Closes', 'Closing time');
  await request({
    ctx, capability: 'business.set_fact',
    input: { key: 'hours', value: { opens: '11:00', closes: '23:00' } },
  });
  await settle();
  line();
  line('     The run did not guess. It stopped at the step that no longer matched.');
  await board(business.id);

  // ---- 5. the repair queue ------------------------------------------------
  const open = await repair.open(business.id);
  line();
  rule();
  line('  5  What the failure left behind');
  rule();
  for (const item of open) {
    const tried = j(item.tried) ?? [];
    line();
    line(`     ${item.package_key}`);
    line(`       step   ${JSON.stringify(j(item.step))}`);
    line(`       why    ${item.reason}`);
    line(`       tried  ${tried.map(t => `${t.by}="${t.value}"`).join('  ') || '(none recorded)'}`);
  }
  line();
  line('     That ladder is the repair. It says which identifier moved, which is');
  line('     the difference between a one-pass fix and re-mapping the app.');

  if (open.length && process.env.ANTHROPIC_API_KEY) {
    line();
    rule();
    line('  6  Repair: propose (read-only) -> dry-run the read path -> a person promotes');
    rule();
    const proposed = await repair.propose({ ctx, repairItemId: open[0].id });
    line(`     proposed  ${proposed.state}`);
    const tested = await repair.dryRun({ ctx, repairItemId: open[0].id });
    line(`     dry run   ${tested.item.state}`);
    if (tested.item.state === 'dry_run_passed') {
      const promoted = await repair.promote({ ctx, repairItemId: open[0].id });
      line(`     promoted  ${promoted.package_key} v${promoted.version} (source=${promoted.source})`);
      await request({ ctx, capability: 'business.set_fact',
                      input: { key: 'hours', value: { opens: '11:00', closes: '23:00' } } });
      await settle();
      await board(business.id);
    }
  } else if (open.length) {
    line();
    rule();
    line('  6  Repair needs a model. Set ANTHROPIC_API_KEY and run again to watch');
    line('     propose -> dry-run -> promote close the loop.');
    rule();
  }

  line();
  rule();
  line('  Nothing above chose a destination, and nothing believed a write it had');
  line('  not read back off the screen.');
  rule();
  line();
}

// Events are written to an outbox in the same transaction as the change that
// caused them, then drained. Draining raises more events (each push succeeds or
// fails), so drain until the outbox stops producing work.
async function settle() {
  for (let i = 0; i < 10; i++) {
    if (await drain() === 0) return;
  }
}

async function board(businessId) {
  const { canonical, channels } = await drift({ businessId, key: 'hours' });
  line();
  line(`     canonical   ${fmt(canonical)}`);
  line();
  for (const c of channels) {
    const mark = c.inSync ? '  ok  ' : ' DRIFT';
    line(`     ${c.provider.padEnd(18)} ${fmt(c.value).padEnd(28)} ${mark}`);
  }
}

function fmt(value) {
  if (value === null || value === undefined) return 'never read';
  if (typeof value === 'object') return `${value.opens ?? '?'} – ${value.closes ?? '?'}`;
  return String(value);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
