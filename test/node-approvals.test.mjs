// The kernel's "ask" path is held by the NODE approval gateway: no grant, wrong grant, or forged signature = refused.
// A fake gateway (same contract as ~/agents/approval-gateway) runs on a random local port; nothing leaves the box.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-'));
fs.writeFileSync(path.join(tmp, 'pub'), publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex'));
process.env.APPROVAL_PUBKEY = path.join(tmp, 'pub');

const reqs = new Map(), grants = new Map();
let forge = false;
const srv = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c; const body = b ? JSON.parse(b) : {};
  const send = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const { canonical, actionHash } = await import('../src/kernel/node-approvals.js');
  if (req.url === '/v1/approvals') {
    const id = 'a_' + crypto.randomUUID(); reqs.set(id, { action: body.action, status: 'pending' });
    return send(201, { request_id: id, tier: 3, status: 'pending', action_hash: actionHash(body.action) });
  }
  if (req.url === '/v1/grants/consume') {
    const g = grants.get(body.grant_id);
    if (!g) return send(403, { error: 'unknown grant' });
    if (g.used) return send(403, { error: 'grant already used' });
    if (g.ah !== body.action_hash) return send(403, { error: 'action does not match approval' });
    g.used = true;
    const fields = { grant_id: body.grant_id, request_id: g.rid, action_hash: g.ah, expires_at: Date.now() / 1000 + 300, consumed_at: Date.now() / 1000 };
    const sig = crypto.sign(null, Buffer.from(canonical(fields)), forge ? crypto.generateKeyPairSync('ed25519').privateKey : privateKey).toString('hex');
    return send(200, { grant: fields, sig_ed25519: sig });
  }
  send(404, {});
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
process.env.CYBERCHECK_APPROVAL_GATEWAY = `http://127.0.0.1:${srv.address().port}`;
const yes = async (rid) => { const { actionHash } = await import('../src/kernel/node-approvals.js');
  const gid = 'g_' + crypto.randomUUID(); grants.set(gid, { rid, ah: actionHash(reqs.get(rid).action) }); return gid; };

const db = await import('../src/db.js');
await db.connect({ schemaDir: path.resolve('db') });
await import('../src/kernel/canonical.js');
const { grant } = await import('../src/kernel/policy.js');
const { request, decide } = await import('../src/kernel/executor.js');
const biz = await db.one(`insert into business (slug, display_name) values ('gate-co','Gate Co') returning *`);
const person = await db.one(`insert into person (email, display_name) values ('o@g.c','Owner') returning *`);
const mem = await db.one(`insert into membership (person_id, business_id, role) values ($1,$2,'owner') returning *`, [person.id, biz.id]);
await grant({ businessId: biz.id, role: 'owner', capability: 'business.set_fact', disposition: 'ask' });
const ctx = { businessId: biz.id, business: biz, person, membership: mem };
const ask = (v) => request({ ctx, capability: 'business.set_fact', input: { key: 'contact.phone', value: v } });
const state = async (id) => (await db.one(`select state from execution where id = $1`, [id])).state;

test('ask files a NODE gateway request and parks', async () => {
  const out = await ask('1');
  assert.equal(out.awaitingApproval, true);
  const a = await db.one(`select node_request_id from approval where execution_id = $1`, [out.execution.id]);
  assert.ok(reqs.has(a.node_request_id));
});
test('local approve without a gateway grant is refused; nothing runs', async () => {
  const out = await ask('2');
  const r = await decide({ ctx, executionId: out.execution.id, decision: 'approve' });
  assert.equal(r.error.code, 'forbidden'); assert.equal(await state(out.execution.id), 'awaiting_approval');
});
test('a grant for a different action is refused', async () => {
  const a = await ask('3'), b = await ask('4');
  const ra = await db.one(`select node_request_id from approval where execution_id = $1`, [a.execution.id]);
  const r = await decide({ ctx, executionId: b.execution.id, decision: 'approve', grantId: await yes(ra.node_request_id) });
  assert.match(r.error.message, /does not match|different action/); assert.equal(await state(b.execution.id), 'awaiting_approval');
});
test('forged gateway signature is refused', async () => {
  const a = await ask('5'); const ra = await db.one(`select node_request_id from approval where execution_id = $1`, [a.execution.id]);
  forge = true; const r = await decide({ ctx, executionId: a.execution.id, decision: 'approve', grantId: await yes(ra.node_request_id) }); forge = false;
  assert.match(r.error.message, /signature/);
});
test('NO rejects without needing the gateway', async () => {
  const a = await ask('6');
  const r = await decide({ ctx, executionId: a.execution.id, decision: 'reject' });
  assert.equal(r.rejected, true);
});
test('YES grant runs the capability once, with a receipt', async () => {
  const a = await ask('7'); const ra = await db.one(`select node_request_id from approval where execution_id = $1`, [a.execution.id]);
  const gid = await yes(ra.node_request_id);
  const r = await decide({ ctx, executionId: a.execution.id, decision: 'approve', grantId: gid });
  assert.equal(r.execution.state, 'succeeded'); assert.ok(r.receipt);
});
test.after(() => srv.close());
