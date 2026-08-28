// Build the container stack from what the packages declare.
//
// A hand-written docker-compose.yml listing every service is the same mistake
// as a hardcoded list of package names in the kernel: it makes a removable
// thing required, and it goes stale the moment a package is added or deleted.
//
// So nothing here names a package. The kernel contributes docker/service.json;
// every package that needs a runtime declares `"runtime": { "compose": ... }`
// in its manifest and ships a fragment beside it. This merges whatever it
// finds and writes docker-compose.generated.yml.
//
// Delete a package directory and its services disappear from the stack. That
// is the only test that matters.
//
// Fragments are JSON so this needs no YAML dependency — the repo has three
// dependencies and none of them parse YAML. The output is real YAML.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docker-compose.generated.yml');

function readFragment(file, label) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw._comment;
  return { label, dir: path.dirname(file), fragment: raw };
}

function collect() {
  const found = [];

  const kernel = path.join(ROOT, 'docker/service.json');
  if (fs.existsSync(kernel)) found.push(readFragment(kernel, 'kernel'));

  const modulesDir = path.join(ROOT, 'modules');
  if (!fs.existsSync(modulesDir)) return found;

  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(modulesDir, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const rel = manifest.runtime?.compose;
    if (!rel) continue;                       // most packages need no container
    const file = path.join(modulesDir, entry.name, rel);
    if (!fs.existsSync(file)) {
      throw new Error(`${manifest.key} declares runtime.compose "${rel}", which does not exist`);
    }
    found.push(readFragment(file, manifest.key));
  }
  return found;
}

// A fragment writes paths relative to itself, because that is the only place
// its author can reason about. The generated file lives at the repo root, so
// every build context is resolved from the fragment and re-expressed from
// there. A package never has to know where the output lands.
function rebase(spec, fromDir) {
  if (!spec?.build?.context) return spec;
  const abs = path.resolve(fromDir, spec.build.context);
  const rel = path.relative(ROOT, abs) || '.';
  return { ...spec, build: { ...spec.build, context: rel.startsWith('.') ? rel : `./${rel}` } };
}

function merge(fragments) {
  const out = { services: {}, volumes: {} };
  const owner = {};
  for (const { label, dir, fragment } of fragments) {
    for (const [name, spec] of Object.entries(fragment.services ?? {})) {
      if (owner[name]) {
        throw new Error(`service "${name}" declared by both ${owner[name]} and ${label}`);
      }
      owner[name] = label;
      out.services[name] = rebase(spec, dir);
    }
    for (const [name, spec] of Object.entries(fragment.volumes ?? {})) {
      out.volumes[name] = spec;
    }
  }
  if (Object.keys(out.volumes).length === 0) delete out.volumes;
  return { merged: out, owner };
}

// Minimal YAML writer for the shape compose files actually take: nested maps,
// arrays of scalars, and scalars. Anything ambiguous is quoted.
function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (value === null) return '';
  if (Array.isArray(value)) {
    return value.map(v => `${pad}- ${scalar(v)}`).join('\n');
  }
  if (typeof value === 'object') {
    const lines = [];
    for (const [k, v] of Object.entries(value)) {
      if (v === null) lines.push(`${pad}${k}:`);
      else if (Array.isArray(v)) lines.push(`${pad}${k}:\n${toYaml(v, indent + 1)}`);
      else if (typeof v === 'object') lines.push(`${pad}${k}:\n${toYaml(v, indent + 1)}`);
      else lines.push(`${pad}${k}: ${scalar(v)}`);
    }
    return lines.join('\n');
  }
  return `${pad}${scalar(value)}`;
}

function scalar(v) {
  if (typeof v !== 'string') return String(v);
  // Quote anything a YAML parser could read as something other than a string.
  if (v === '' || /^[\s]|[\s]$|^[-?:,\[\]{}#&*!|>'"%@`]|:\s|\s#|^(true|false|null|yes|no|on|off|~)$/i.test(v)
      || /^-?\d+(\.\d+)?$/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

const fragments = collect();
const { merged, owner } = merge(fragments);

const header = [
  '# GENERATED — do not edit. Regenerate with: npm run compose',
  '#',
  '# Every service below comes from a fragment its own package ships. Nothing',
  '# in the generator names a package; delete a package and its services go.',
  '#',
  ...Object.entries(owner).map(([svc, label]) => `#   ${svc.padEnd(20)} ${label}`),
  '',
].join('\n');

fs.writeFileSync(OUT, header + toYaml(merged) + '\n');

console.log(`wrote ${path.relative(ROOT, OUT)}`);
for (const { label, fragment } of fragments) {
  const names = Object.keys(fragment.services ?? {});
  console.log(`  ${label.padEnd(22)} ${names.join(', ') || '(no services)'}`);
}
