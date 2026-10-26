import crypto from 'node:crypto';
import fs from 'node:fs';
// The cybercheck kernel's "ask" disposition, wired to the ONE NODE approval gateway (127.0.0.1:7795).
// An approval is a capability the executor checks, not a promise: decide(approve) runs only with a
// single-use gateway grant bound to this exact action (sha256 of canonical JSON), whose Ed25519
// signature verifies against the gateway's public key. Gateway down = refused (fail closed).
// CYBERCHECK_APPROVAL_GATEWAY=off keeps local-only approvals for offline development.
export const GW = process.env.CYBERCHECK_APPROVAL_GATEWAY ?? 'http://127.0.0.1:7795';
export const enabled = () => (process.env.CYBERCHECK_APPROVAL_GATEWAY ?? GW) !== 'off';
const PUB_FILES = [process.env.APPROVAL_PUBKEY, '/etc/node-approvals/grant-ed25519.pub',
  `${process.env.HOME}/.config/node-approvals/grant-ed25519.pub`].filter(Boolean);

// Same bytes as Python json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export const actionHash = (a) => crypto.createHash('sha256').update(canonical(a)).digest('hex');
export const actionFor = ({ execution }) => ({
  type: 'cybercheck_capability', capability: execution.capability, business_id: execution.business_id,
  execution_id: execution.id, input: typeof execution.input === 'string' ? JSON.parse(execution.input) : execution.input,
});

async function call(path, body) {
  const base = process.env.CYBERCHECK_APPROVAL_GATEWAY && process.env.CYBERCHECK_APPROVAL_GATEWAY !== 'off'
    ? process.env.CYBERCHECK_APPROVAL_GATEWAY : 'http://127.0.0.1:7795';
  const r = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

export async function ask({ execution, requester }) {
  const action = actionFor({ execution });
  const { body } = await call('/v1/approvals', {
    action, reason: `cybercheck ${execution.capability} for business ${execution.business_id}`,
    requester: { agent_id: requester ?? 'cybercheck-kernel', adapter: 'cybercheck', run_id: execution.id },
    idempotency_key: `cybercheck:${execution.id}`,
  });
  return body;   // {request_id, tier, status, grant_id?}
}

function pubKey() {
  const f = PUB_FILES.find(p => fs.existsSync(p));
  if (!f) return null;
  const raw = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
}

export class Refused extends Error {}
export async function requireGrant(grantId, action) {
  if (!grantId) throw new Refused('no approval grant: refusing');
  const ah = actionHash(action);
  let res;
  try { res = await call('/v1/grants/consume', { grant_id: grantId, action_hash: ah }); }
  catch (e) { throw new Refused(`approval gateway unreachable, failing closed: ${e.message}`); }
  if (res.status !== 200) throw new Refused(`gateway refused grant: ${res.body.error ?? res.status}`);
  const g = res.body.grant ?? {};
  const key = pubKey();
  if (!key || !res.body.sig_ed25519) throw new Refused('no gateway public key / signature: refusing');
  const ok = crypto.verify(null, Buffer.from(canonical(g)), key, Buffer.from(res.body.sig_ed25519, 'hex'));
  if (!ok) throw new Refused('grant signature does not verify');
  if (g.action_hash !== ah) throw new Refused('grant is for a different action');
  if (!g.consumed_at || g.expires_at < Date.now() / 1000 - 5) throw new Refused('grant expired');
  return g;
}
