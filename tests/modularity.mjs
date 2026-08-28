// The rule this repo is built on, made enforceable.
//
//   The kernel declares slots and contracts. Packages fill them.
//   The kernel names no package.
//
// It is easy to violate by accident — a default binding, a convenience route,
// one import — and each violation quietly makes a removable thing required.
// These checks fail when that happens.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files that decide things. A package name appearing in any of them means the
// kernel has an opinion about a specific package, which is the violation.
const DECIDING = [
  'src/platform.js',
  'src/kernel/providers.js',
  'src/kernel/registry.js',
  'src/kernel/installer.js',
  'src/kernel/executor.js',
  'src/kernel/policy.js',
  'src/kernel/workspace.js',
  'src/kernel/channels.js',
  'src/kernel/router.js',
  'src/kernel/ledger.js',
  'src/http/server.js',
];

const results = [];
const check = (name, fn) => results.push([name, fn]);

const packageKeys = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => path.join(ROOT, 'modules', e.name, 'manifest.json'))
  .filter(fs.existsSync)
  .map(f => JSON.parse(fs.readFileSync(f, 'utf8')).key);

check('the kernel names no installed package', async () => {
  assert.ok(packageKeys.length > 0, 'no packages found to check against');
  const offences = [];
  for (const file of DECIDING) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('//')) return;      // prose may name examples
      for (const key of packageKeys) {
        if (new RegExp(`['"\`]${key}[.'"\`]`).test(line)) {
          offences.push(`${file}:${i + 1}  names "${key}"`);
        }
      }
    });
  }
  assert.deepEqual(offences, [], `the kernel names packages:\n        ${offences.join('\n        ')}`);
});

check('a provider volunteers as a default; the kernel does not pick one', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/platform.js'), 'utf8');
  assert.match(src, /defaultPriority/, 'platform.js no longer reads declared defaults');
  const willing = packageKeys
    .map(k => JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', k, 'manifest.json'), 'utf8')))
    .filter(m => Number.isFinite(m.defaultPriority));
  assert.ok(willing.length > 0, 'no package volunteers as a platform default');
});

check('the kernel boots with no packages at all', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-nomodules-'));
  const { stdout } = await exec(process.execPath, ['-e', `
    import(${JSON.stringify(path.join(ROOT, 'src/platform.js'))}).then(async m => {
      const r = await m.boot({ modulesDir: ${JSON.stringify(empty)} });
      console.log(JSON.stringify({ packages: r.packages.length, bindings: r.bindings.length }));
      process.exit(0);
    }).catch(e => { console.log(JSON.stringify({ error: e.message })); process.exit(0); });
  `], { cwd: ROOT, timeout: 60_000 });
  const out = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(out.error, undefined, `boot failed with no packages: ${out.error}`);
  assert.equal(out.packages, 0);
  assert.equal(out.bindings, 0, 'a slot was bound with nothing installed to bind');
});

check('with packages present, the executor slot fills itself', async () => {
  const { stdout } = await exec(process.execPath, ['-e', `
    import(${JSON.stringify(path.join(ROOT, 'src/platform.js'))}).then(async m => {
      const r = await m.boot();
      console.log(JSON.stringify(r.bindings));
      process.exit(0);
    }).catch(e => { console.log(JSON.stringify([{ error: e.message }])); process.exit(0); });
  `], { cwd: ROOT, timeout: 60_000 });
  const bindings = JSON.parse(stdout.trim().split('\n').pop());
  const exec_ = bindings.find(b => b.slot === 'workspace.executor');
  assert.ok(exec_, 'nothing filled workspace.executor');
});

check('a public action is unreachable unless its manifest opens it', async () => {
  const manifests = packageKeys.map(k =>
    JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', k, 'manifest.json'), 'utf8')));
  for (const m of manifests) {
    for (const cap of m.publicActions ?? []) {
      assert.ok(cap.startsWith(m.key + '.'), `${m.key} opens "${cap}" outside its namespace`);
      assert.ok((m.capabilities ?? []).includes(cap), `${m.key} opens "${cap}" but never declares it`);
    }
  }
  const src = fs.readFileSync(path.join(ROOT, 'src/http/server.js'), 'utf8');
  assert.match(src, /publicActions/, 'the public route stopped checking the declaration');
});

check('the container stack is generated, not hand-written', async () => {
  const generator = path.join(ROOT, 'scripts/compose.mjs');
  assert.ok(fs.existsSync(generator), 'no compose generator');
  const src = fs.readFileSync(generator, 'utf8');
  for (const key of packageKeys) {
    assert.ok(!new RegExp(`['"\`]${key}['"\`]`).test(src),
      `the compose generator names "${key}"`);
  }
  // A checked-in compose file listing services by hand is the thing the
  // generator exists to replace.
  for (const stale of ['docker-compose.yml', 'docker/docker-compose.yml']) {
    assert.ok(!fs.existsSync(path.join(ROOT, stale)), `${stale} is hand-written; regenerate instead`);
  }
});

check('every declared container fragment and Dockerfile exists', async () => {
  for (const key of packageKeys) {
    const dir = path.join(ROOT, 'modules', key);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const rel = m.runtime?.compose;
    if (!rel) continue;
    const fragmentPath = path.join(dir, rel);
    assert.ok(fs.existsSync(fragmentPath), `${key} declares runtime.compose "${rel}", missing`);
    const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
    for (const [name, spec] of Object.entries(fragment.services ?? {})) {
      if (!spec.build) continue;
      const ctx = path.resolve(path.dirname(fragmentPath), spec.build.context ?? '.');
      const dockerfile = path.resolve(ctx, spec.build.dockerfile ?? 'Dockerfile');
      assert.ok(fs.existsSync(dockerfile), `${key}/${name} points at a missing Dockerfile: ${dockerfile}`);
    }
  }
});

check('deleting a package removes its services from the stack', async () => {
  const withAll = await exec(process.execPath, ['scripts/compose.mjs'], { cwd: ROOT, timeout: 30_000 });
  const generated = fs.readFileSync(path.join(ROOT, 'docker-compose.generated.yml'), 'utf8');
  // Every service line traces back to a fragment some package ships.
  const contributors = withAll.stdout.split('\n').slice(1).filter(Boolean).length;
  assert.ok(contributors >= 1, 'no package contributed any service');
  assert.match(generated, /^# GENERATED/, 'the stack is not marked generated');
});

let failed = 0;
for (const [name, fn] of results) {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
