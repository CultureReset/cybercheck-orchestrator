# cybercheck-orchestrator

The kernel. `package.json` calls it `ghost-platform`.

Every action in the estate — a dashboard click, an automation, a module calling
another module, a harness pursuing a goal — goes through one loop here and
leaves a receipt. Nothing executes any other way.

> **The real documentation is in `docs/`.** This file is a map of the code as
> it exists in this checkout; `docs/` is the design and the record.
>
> | | |
> |---|---|
> | `docs/README.md` | the platform, the kernel/package split, the execution model |
> | `docs/STATUS.md` | every item built and not built, with what proves each one |
> | `docs/CORPUS-INDEX.md` | what is in the source documents, read programmatically |
> | `docs/ghost-modular-build-plan.md` | the modular build plan |
> | `docs/02-foundation-build-guide.md` | the foundation guide |
> | `docs/demos/` | recorded demo output |
>
> Also read `RECOVERY.md` before trusting anything here. This checkout was
> reconstituted from PDF printouts; 28 of 28 recovered `.js` files parse and the
> 4 SQL migrations are byte-identical to the originals, but it is not a normal
> checkout — **and the counts below are of what survived, not of what was
> built.** `docs/STATUS.md` describes the original as 3,557 lines across 39 JS
> files, 43 tables, 14 packages and 48 HTTP endpoints. This tree has 28 JS
> files, 41 tables, 2 packages and 40 routes. The difference is what recovery
> lost.

## The loop

`src/kernel/executor.js`:

```
request -> plan -> route -> approval? -> execute -> verify -> receipt
```

- **Capabilities** (`policy.js`) — a capability is a named verb with a handler.
  `defineCapability()` registers it; `resolveDisposition()` decides whether this
  actor may invoke it on this resource. There is no other execution path.
- **Receipts** (`ledger.js`) — every completed execution writes one, chained per
  business: `chain_hash = sha256(prev_hash + payload_hash)`. Edit or remove a
  receipt and `verifyChain()` fails for everything after it.
- **Idempotency** — a repeated `idempotencyKey` replays the stored execution
  instead of acting twice.

## Canonical facts

`src/kernel/canonical.js`. A fact has an authority rank, lowest wins:

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|
| owner | staff | pos | booking | connector | website | directory | scrape | inference |

Facts are versioned by `effective_to`, not overwritten. Drift is a comparison
between what an app reports and the canonical value — never an assumption.

## Fan-out and AppMaps

`src/kernel/fanout.js`. Nobody tells the platform to update Facebook. A
canonical value changes, and every installed app that carries that value gets a
run queued against it. The owner never picks the destinations.

What each app carries and how to write it lives in the `appmap` table
(`db/002_workspace.sql`):

```sql
create table appmap (
  package_key     text not null,
  version         text not null,
  android_package text,
  carries         jsonb,  -- which canonical keys this app holds
  routes          jsonb,  -- key -> { write: [...steps], read: [...steps] }
  status          text not null default 'active',
  unique (package_key, version)
);
```

When a map stops matching reality the run lands in `repair_item` instead of
silently writing the wrong thing.

**Execution is the device, not an API.** The executor is the business's own
cloud Android instance — `provision()` creates two workloads on one host, the
Android instance and a container, each with a persistent volume. The business
installs the real apps onto it and logs in with their own accounts. The
credential never leaves the workspace.

## Harnesses

`src/kernel/harness.js`. **A harness gets a goal, not a database.**

It is bound per business in the `harness` provider slot. On each run it is
offered only the capabilities this actor is actually granted — anything with
`agentSafe === false` is withheld as script-only, because a model may read an
outside app but may not write to one. It receives two functions, `invoke` (run a
capability) and `think` (route a task to a model), and nothing else. Every run
is recorded in `harness_run` with its steps and result.

A harness cannot widen its own permissions.

## Model routing

`src/kernel/router.js` knows no vendor. It asks every bound model provider what
it offers, scores the candidates against the task
(`{ need: 'reasoning' | 'cheap' | 'fast' | 'vision', maxCents, prompt }`), picks,
falls back on failure, and records the decision in `routing_decision`.

## Packages

The kernel is `src/` plus the SQL. It contains no business features. Everything
else is a package in `modules/`, and every one of them is removable.

Package kinds, per `docs/README.md`:

| `app` | own data, a dashboard, optionally a public section — QR menu, forms, CRM |
| --- | --- |
| `channel_app` | a real Android app the business installs on their own device and logs into — Facebook, Google Business Profile, Yelp. **Carries an appmap.** |
| `automations` | data, not code. A trigger and a list of capability calls. Publishable. |

A package is a directory with a `manifest.json`. `registry.js` reads every one,
validates it, registers its capabilities and publishes it for install.

```
modules/
  business_profile/
  availability/     manifest.json + index.js
```

A manifest declares `key`, `version`, `kind`, `requires`, `capabilities`,
`sensitive`, a `schema` of slot fields, and the `public` surfaces it renders.
Installing one provisions its physical tables (`provisioned_table`).

## Layout

```
src/kernel/     23 files — the loop, the registry, and everything above
src/drivers/    android.js
src/http/       server.js — 40 routes
src/db.js       q / one / j
src/platform.js
db/             001_kernel · 002_workspace · 003_providers · 004_marketplace
modules/        installable packages
```

41 tables. Notable ones beyond the above: `execution`, `approval`, `grant_row`,
`observation`, `projection_map`, `workspace`, `device_session`, `device_app`,
`provider_binding`, `package_signature`, `build_plan`, `access_token`,
`search_intent`, `shared_automation`.

## HTTP

```
GET    /api/packages · /api/capabilities · /api/slots
GET    /api/b/:slug/installs           POST · DELETE /:key
POST   /api/b/:slug/invoke             run a capability
GET    /api/b/:slug/approvals          POST /:executionId
GET    /api/b/:slug/receipts
GET    /api/b/:slug/drift/:key
POST   /api/b/:slug/harness            give a harness a goal
POST   /api/b/:slug/think              route a task to a model
GET    /api/b/:slug/routing
GET    /api/b/:slug/providers          POST
GET    /api/b/:slug/workspaces         POST
GET    /api/b/:slug/device/apps        POST · DELETE /:key
POST   /api/b/:slug/device/session     DELETE /:id
GET    /api/b/:slug/device/screen
GET    /api/b/:slug/sync               POST /:key
GET    /api/b/:slug/repairs
GET    /api/automations                POST /api/b/:slug/automations
GET    /api/b/:slug/intent
POST   /api/b/:slug/tokens             DELETE /:id
GET    /mcp/:slug · /mcp/:slug/private · /mcp/:slug/:section
GET    /p/:slug · /l/:slug · /embed/:slug/:section
POST   /public/:slug/availability/search
```

## Run

```bash
npm start            # node src/http/server.js
npm run verify       # node verify.mjs
npm run demo         # demo.js · demo-device.js · demo-modular.js · demo-surfaces.js
```

`express` 5, `pg`, `pg-mem`. ESM.
