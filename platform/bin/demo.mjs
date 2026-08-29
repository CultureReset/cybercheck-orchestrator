#!/usr/bin/env node
// Brings the whole thing up on one machine: the platform, the store, and two
// apps that were written without either of them knowing about the other.
//
//   npm run platform:demo
//
// Then sign in with the printed credentials, install both apps, and put the
// song request form on the public page.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { connect, reset, one } from '../src/db.js';
import { createServer } from '../src/http/server.js';
import { ensureStore, publish } from '../src/catalog.js';
import { signingKey } from '../src/tokens.js';
import { deliverPending } from '../src/events.js';
import { register } from '../src/identity.js';
import { app as notifierApp } from '../apps/notifier/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const PLATFORM_PORT = Number(process.env.PORT ?? 4000);
const SONG_PORT = 4101;
const NOTIFIER_PORT = 4102;
const FRESH = process.argv.includes('--fresh');

const EMAIL = 'owner@example.com';
const PASSWORD = 'correct-horse-battery';

await connect();
if (FRESH) await reset();
await signingKey();
await ensureStore({ slug: 'official', name: 'Official Store', kind: 'local' });

// The demo apps are served from their own origins, which is the point: the
// platform iframes them, it does not host them.
const songServer = express()
  .use(express.static(path.join(ROOT, 'apps', 'song-request')))
  .listen(SONG_PORT);
const notifierServer = notifierApp.listen(NOTIFIER_PORT);
process.env.PLATFORM_URL = `http://localhost:${PLATFORM_PORT}`;

const platform = createServer().listen(PLATFORM_PORT);

for (const name of ['song-request', 'notifier']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', name, 'manifest.json'), 'utf8'));
  try {
    await publish({ manifest });
    console.log(`published  ${manifest.id}@${manifest.version}`);
  } catch (e) {
    console.log(`published  ${manifest.id}@${manifest.version}  (already: ${e.message})`);
  }
}

const existing = await one('select id from platform.users where email = $1', [EMAIL]);
if (!existing) {
  await register({ email: EMAIL, name: 'Sam Owner', password: PASSWORD, organizationName: 'Blue Bar' });
  console.log(`created    ${EMAIL}`);
}

// Events are delivered by a loop, not by the request that emitted them.
setInterval(() => deliverPending().catch(e => console.error('delivery:', e.message)), 3000).unref();

console.log(`
  store        http://localhost:${PLATFORM_PORT}
  public page  http://localhost:${PLATFORM_PORT}/p/blue-bar
  sign in      ${EMAIL} / ${PASSWORD}

  song request app  http://localhost:${SONG_PORT}   (its own origin)
  notifier service  http://localhost:${NOTIFIER_PORT}   (no UI at all)

  Ctrl-C to stop.
`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const server of [platform, songServer, notifierServer]) server.close();
    process.exit(0);
  });
}
