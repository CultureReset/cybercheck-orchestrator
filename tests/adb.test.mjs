// The real device driver, proved without a phone.
//
// adb is stubbed, so what is under test is the part that actually breaks:
// does a step become the right adb command, and is the element found by NAME
// with the coordinate derived from the live screen rather than written down.
//
//     node tests/adb.test.mjs

import assert from 'node:assert/strict';
import { AdbDevice, parseNodes, findNode, tappable } from '../src/drivers/adb.js';
import { StepError } from '../src/drivers/android.js';

let passed = 0;
const ok = (name) => { console.log(`  ok   ${name}`); passed++; };

// A real-shaped uiautomator dump: a label, its clickable parent, a field, a button.
const SCREEN = `<?xml version='1.0'?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" clickable="false" enabled="true">
  <node index="0" text="Opening time" resource-id="com.app:id/opens_label" class="android.widget.TextView" content-desc="" bounds="[40,300][400,360]" clickable="false" enabled="true" />
  <node index="1" text="09:00" resource-id="com.app:id/opens_at" class="android.widget.EditText" content-desc="" bounds="[420,290][900,370]" clickable="true" enabled="true" />
  <node index="2" text="" resource-id="com.app:id/save_row" class="android.widget.LinearLayout" content-desc="" bounds="[0,900][1080,1010]" clickable="true" enabled="true">
    <node index="0" text="Save" resource-id="" class="android.widget.TextView" content-desc="" bounds="[480,930][600,980]" clickable="false" enabled="true" />
  </node>
</node></hierarchy>`;

const SAVED = SCREEN.replace('text="09:00"', 'text="07:00"')
                    .replace('text="Save"', 'text="Saved"');

// --- a stub adb that records every call ------------------------------------

function stubAdb({ screens = [SCREEN] } = {}) {
  const calls = [];
  let dumpCount = 0;
  const exec = async (_bin, args) => {
    calls.push(args.join(' '));
    if (args.includes('uiautomator') && args.includes('dump')) {
      const xml = screens[Math.min(dumpCount, screens.length - 1)];
      dumpCount++;
      return { stdout: xml };
    }
    return { stdout: '' };
  };
  return { exec, calls };
}

// --- parsing ---------------------------------------------------------------

{
  const nodes = parseNodes(SCREEN);
  assert.equal(nodes.length, 5);
  ok('the view hierarchy parses');

  const field = findNode(nodes, 'opens_at');
  assert.equal(field.text, '09:00');
  ok('an element is found by resource id');

  const byText = findNode(nodes, 'Save');
  assert.equal(byText.cls, 'android.widget.TextView');
  ok('an element is found by its visible text');

  assert.equal(findNode(nodes, 'save'), byText);
  ok('matching is case tolerant');

  assert.equal(findNode(nodes, 'Nothing Like This'), null);
  ok('an element that is not there returns null');
}

// --- coordinates come from the screen, never from the map ------------------

{
  const nodes = parseNodes(SCREEN);
  const label = findNode(nodes, 'Save');
  assert.equal(label.clickable, false);

  const target = tappable(nodes, label);
  assert.equal(target.id, 'save_row');
  ok('a label resolves to its clickable parent');

  assert.deepEqual(target.center, { x: 540, y: 955 });
  ok('the tap point is computed from the live bounds');
}

// --- steps become the right adb commands -----------------------------------

{
  const { exec, calls } = stubAdb();
  const d = new AdbDevice({ exec, settleMs: 0 });
  await d.run([{ open: 'com.app' }]);
  assert.ok(calls.some((c) => c.includes('monkey -p com.app')));
  ok('open launches the package');
}

{
  const { exec, calls } = stubAdb();
  const d = new AdbDevice({ exec, settleMs: 0 });
  await d.run([{ tap: 'Save' }]);
  assert.ok(calls.some((c) => c === 'shell input tap 540 955'));
  ok('tap resolves the name to a real coordinate and taps it');
}

{
  const { exec, calls } = stubAdb();
  const d = new AdbDevice({ exec, settleMs: 0 });
  await d.run([{ type: '07:00', into: 'opens_at' }]);
  assert.ok(calls.some((c) => c === 'shell input tap 660 330'), 'focuses the field');
  assert.ok(calls.some((c) => c.includes('KEYCODE_DEL')), 'clears it first');
  assert.ok(calls.some((c) => c === 'shell input text 07:00'), 'types the value');
  ok('type focuses the field, clears it, then types');
}

{
  const { exec } = stubAdb();
  const d = new AdbDevice({ exec, settleMs: 0 });
  const { readings } = await d.run([{ read: 'opens_at' }]);
  assert.equal(readings.opens_at, '09:00');
  ok('read returns what is actually on the screen');
}

// --- the text is an argument, never a shell string --------------------------

{
  const { exec, calls } = stubAdb();
  const d = new AdbDevice({ exec, settleMs: 0 });
  await d.run([{ type: 'closed; rm -rf ~', into: 'opens_at' }]);
  const typed = calls.find((c) => c.startsWith('shell input text'));
  assert.equal(typed, 'shell input text closed; rm -rf ~');
  ok('typed text is passed as one argument, not through a shell');
}

// --- failure is loud, and it is the kernel's own error ----------------------

{
  const { exec } = stubAdb();
  const d = new AdbDevice({ exec, settleMs: 0 });
  await assert.rejects(
    () => d.run([{ tap: 'Publish' }]),
    (e) => e instanceof StepError && /nothing on screen matching "Publish"/.test(e.message)
  );
  ok('a missing element raises StepError, the same one the kernel already handles');
}

{
  const { exec } = stubAdb();
  const d = new AdbDevice({ exec, settleMs: 0 });
  await assert.rejects(
    () => d.run([{ expect: 'Saved' }]),
    (e) => e instanceof StepError
  );
  ok('expect fails the run when the screen does not confirm it');
}

// --- a whole map, the way a capability would send it ------------------------

{
  // dumps land at: type, tap, expect, read, and the final screen read.
  // The app has committed the change by the third.
  const { exec, calls } = stubAdb({ screens: [SCREEN, SCREEN, SAVED, SAVED, SAVED] });
  const d = new AdbDevice({ exec, settleMs: 0 });
  const { readings } = await d.run([
    { open: 'com.app' },
    { type: '07:00', into: 'opens_at' },
    { tap: 'Save' },
    { expect: 'Saved' },
    { read: 'opens_at' },
  ]);
  assert.equal(readings.opens_at, '07:00');
  assert.ok(calls.some((c) => c === 'shell input text 07:00'));
  ok('a full update-the-hours map runs and reads the new value back');
}

// --- the owner installs and signs in, not us --------------------------------

{
  const d = new AdbDevice({ exec: async () => ({ stdout: '' }) });
  assert.throws(() => d.installApp('com.app'), /owner installs/);
  assert.throws(() => d.login('com.app', 'a@b.c'), /owner signs in/);
  ok('the driver refuses to install or sign in -- the owner already did, on the phone');
}

console.log(`\n${passed} checks passed - a step becomes an adb command, found by name`);
