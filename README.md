# cybercheck-orchestrator

> Status: active in October 2026 (commits in the last 30 days: 2026-10-26, a CultureReset commit on branch `node-approval-gateway-wiring`, PR #1) — role unconfirmed; a recovered prototype kernel, not shown to be deployed. Last verified against code 2026-11-02 (default-branch commit 071c684). **The default branch holds a small tree (51 files, 2 packages). The richest tree is branch `claude/android-device-control-arch-v2ebwr` (89 files, 11 packages).** This is a public GitHub repository. Its package name inside `package.json` is `ghost-platform`.

## What it is

A Node (ESM, Express 5, `pg` / `pg-mem`) "kernel" for a modular business platform: capabilities, grants, approvals and hash-chained receipts, with feature packages loaded from `modules/*/manifest.json`. Every capability is meant to have a verifier; otherwise the result is reported as `unknown`. Dispositions are auto / ask / never. The source was recovered from PDF printouts (`RECOVERY.md`); `src/db.js` was **reconstructed**, not recovered.

## Which branch to read

| Branch | Last commit | Size | Notes |
| --- | --- | --- | --- |
| `claude/admin-dashboard-repos-review-903d4i` (default, 2 commits, 2026-08-27) | 2026-08-27 | 51 files | Kernel + 2 module folders (`availability`, `business_profile`) |
| `claude/android-device-control-arch-v2ebwr` | 2026-08-30 | 89 files | **Fullest tree**: 11 module folders, real ADB device code, `deviced/` and `voice/` Python services, systemd units, `scripts/` |
| `claude/review-codebase-zips-hck9hd` | 2026-08-28 | 77 files | 8 commits ahead; modules `android_local_node`, `android_simulator`, `availability`, `business_profile`, `voice_openai` |
| `node-approval-gateway-wiring` (PR #1) | 2026-10-26 | 1 commit ahead | Wires the `ask` disposition to the NODE approval gateway with single-use Ed25519-verified grants (fail closed); adds `test/node-approvals.test.mjs` |
| Others | Sep 2026 | small | `new-session-kwipiw`, `linux-build-cleanup-dfpu0e`, `android-device-control-arch-u0ljgd`, `repo-architecture-review-4q452u`, `modular-web-app-store-32zh3e`, `repo-code-analysis-y4n1k7` |

Merge state of PR #1 could not be read. No branch has been compared line by line; the file counts above come from the git trees.

## Where it fits

- Standalone: it imports nothing from other CultureReset repos and uses no Supabase client; it does not touch the `cyber check` database and does not call `gcr-api-clean`. It runs on plain Postgres (`DATABASE_URL`) or in-memory `pg-mem`.
- The only link to another system is on the PR #1 branch: the NODE approval gateway (default `http://127.0.0.1:7795`, `/v1/approvals`, `/v1/grants/consume`). The importer fetches `api.github.com`.

## Run / test

Read from `package.json` and `verify.mjs`; **not executed (needs `npm install` for `express`, `pg-mem`) and unverified**:

```bash
npm install
npm run verify      # node verify.mjs, a 10-step script
npm start           # node src/http/server.js, PORT or 3000
```

- On the default branch `npm start` is documented (`RECOVERY.md`) and appears from the code to fail at boot: `defaults()` binds `android_cloud`, which is absent here.
- `demo`, `demo:device`, `demo:modular`, `demo:surfaces` in `package.json` point at files that do not exist on the default branch, so the demo transcripts in `docs/demos/` cannot be reproduced there.
- No tests and no CI on the default branch. On the PR #1 branch, `"test": "node --test test/"` errors on Node 22 (a directory argument is treated as a module path), and the test imports the whole kernel and `db.js`, so it also needs `pg-mem`.

## Known gaps

- **`modules/business_profile` has no `manifest.json` on the default branch**, so `loadPackages` skips it; `availability` declares `requires: ["business_profile"]`, so installing availability fails the installer's dependency check, and `business_profile.update_contact` is never registered. (The `claude/android-device-control-arch-v2ebwr` branch does carry a `modules/business_profile/manifest.json`.)
- **Identity is stubbed**: `withContext` in `src/http/server.js` trusts the `x-person-id` header, so any caller can claim any person UUID before membership and grants are checked (a comment says it is stubbed on purpose). Do not expose it.
- Package signing uses an HMAC with the default key `development-signing-key` unless `PACKAGE_SIGNING_KEY` is set; the receipt hash chain lives in the same database it protects.
- 12 of 14 documented packages are missing from the default branch; the Android driver there is an in-process simulator only (`src/drivers/android.js`, "adb seam not written yet") and the model provider defaults to `simulate: true`.
- `docs/STATUS.md` claims "3,557 lines across 39 JS files, 43 tables, 14 packages ... all four demos pass". The default branch has 2,811 lines in 29 JS files, 44 tables, 2 package folders (1 loadable), and the demos cannot run; the endpoint count (48) is right. `RECOVERY.md` itself says those claims are unverified.
- Table names are singular and routes are `/api/b/:slug/...`; the product spec in `RECOVERY.md` uses plural names and `/v1/businesses/{id}/...`; unreconciled.
- On PR #1: the gateway grant is consumed before the signature is verified (a bad signature burns the grant; fails closed), and the gateway check defaults to on, so a machine without the gateway refuses every approval.

## Related repos

- NODE approval gateway (`approval-gateway`): the service PR #1 calls.
- `nextgent-platform` / `nextgent-box`: the box-side execution stack this kernel's ideas overlap (policy ALLOW/ASK/DENY, receipts); no code is shared.

## Inside this repo (from the code)

Read from the default-branch tree at 071c684 plus `git ls-tree` of the other branches; nothing was run, so runtime behaviour is unverified.

**Shape.** JavaScript 29 files / 2,811 lines in `src/` and `modules/` (+ `verify.mjs` 56 lines); SQL 4 files / 687 lines; docs 12 files; `RECOVERY.md` 113 lines.

**Directory map (default branch)**
- `src/kernel/` (22 files): `policy` (capability registry and grants), `executor` (request, plan, route, approval, execute, verify, receipt), `gateway` (per-package scoped DB access), `ledger` (hash-chained receipts), `canonical` (3 capabilities: `business.set_fact`, `set_hours`, `set_temporary_closure`), `channels` (`channel.push`, `channel.read`), `registry` (loads `modules/*/manifest.json`), `installer`, `providers` (slots: workspace.executor, model, harness, builder, memory, sandbox), `router`, `harness`, `builder`, `importer` (GitHub repo import), `mcp` (public and private surfaces), `links` / `projection` (link-in-bio and embed HTML), `automation`, `workspace`, `fanout`, `events`, `signing`.
- `src/db.js` (91 lines, reconstructed), `src/platform.js` (boot, `contextFor`), `src/http/server.js` (281 lines), `src/drivers/android.js` (90 lines, simulator only).
- `modules/availability` (manifest + `index.js`: `availability.define/search/hold/release`), `modules/business_profile` (`index.js`, 65 lines, no manifest).
- `db/001_kernel.sql` .. `004_marketplace.sql`: 44 plain-Postgres tables (kernel 20, workspace 6, providers 9, marketplace 9).

**Interfaces.** 48 `app.METHOD` routes in `server.js`: `/api/packages`, `/api/capabilities`, `/api/slots`; per-business `/api/b/:slug/...` (installs, invoke, approvals and decide, receipts, drift, workspaces, device, sync, repairs, automations, tokens, providers, think, routing, harness, build/plan, import, intent); public `/p/:slug`, `/l/:slug`, `/embed/:slug/:section`, `POST /public/:slug/availability/search`; MCP-like `/mcp/:slug` and `/mcp/:slug/private` (bearer token), `/mcp/:slug/:section`; `/api/packages/:key/:version/signature`. 9 capabilities are registered at boot. The public routes are unauthenticated by design.

**Env var names.** `DATABASE_URL`, `PORT`, `PACKAGE_SIGNING_KEY`; on the PR #1 branch also `CYBERCHECK_APPROVAL_GATEWAY` (`off` disables) and `APPROVAL_PUBKEY` (plus two public-key file paths).

**Dependencies.** `express`, `pg`, `pg-mem`; the v2ebwr branch adds `@anthropic-ai/sdk`.

**Stubbed or missing.** 12 of 14 packages (`qr_menu`, `forms`, `crm`, `facebook`, `google_business`, `yelp`, `android_cloud`, `android_local_node`, `hosted_models`, `local_models`, `loop_harness`, `composer`) are absent on the default branch; several exist on `claude/android-device-control-arch-v2ebwr`, which also adds `deviced/app.py` and `voice/app.py` (Python, uvicorn on 8391 and 8392 per its `package.json`), `systemd/` units and `scripts/` (`provision.sh`, `bootstrap.sh`, `attach-phone.mjs`, `capture-map.mjs`). The Python services and the real ADB code on that branch were not examined.

**Unique here.** The verified-execution loop (every capability needs a verifier or reports `unknown`), hash-chained receipts, the three-way disposition, signed packages, and on the PR #1 branch the single-use, action-bound Ed25519 grant check against the NODE approval gateway.
